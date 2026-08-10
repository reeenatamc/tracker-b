/**
 * One-shot importer: turns the original spreadsheet into the structured content
 * the app reads at runtime.
 *
 *   operacion_tesis_tracker_v2.xlsx
 *     -> content/program.yaml         training program (phases, sessions, exercises)
 *     -> content/ankle-protocol.yaml  ankle baseline + 6-week rehab protocol
 *     -> content/sources.yaml         evidence base
 *     -> content/first-session.json   the 8-Aug session, seeded as real history
 *
 * Sections are located by their header text rather than fixed row numbers, so
 * editing the spreadsheet does not silently shift the parse.
 *
 * Run with: npm run import:excel
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { XMLParser } from 'fast-xml-parser'
import { unzipSync } from 'fflate'
import { stringify } from 'yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WORKBOOK = resolve(ROOT, 'operacion_tesis_tracker_v2.xlsx')
const OUT_DIR = resolve(ROOT, 'content')

// -------------------------------------------------------------- xlsx reading

/**
 * Minimal .xlsx reader.
 *
 * ExcelJS cannot open this particular workbook: its relationship targets are
 * absolute ("/xl/worksheets/sheet1.xml") and ExcelJS never normalises the
 * leading slash, so it resolves no sheets at all. An .xlsx is just a zip of
 * XML, and we only need cell text, so reading it directly is both smaller and
 * more predictable than swapping in another heavyweight dependency.
 */

/** A worksheet flattened to plain values, indexed [row][col] with 1-based keys. */
type Grid = Map<number, Map<number, string>>

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // This workbook namespaces every element ("x:workbook", "x:sheetData") and
  // references sheets through "r:id"; stripping prefixes makes both uniform.
  removeNSPrefix: true,
  // Keep everything as strings: Excel serials must not be reformatted by a
  // number parser before we decide whether they are dates.
  parseTagValue: false,
  parseAttributeValue: false,
})

/** fast-xml-parser collapses single-element lists; this puts them back. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** Text content of a node, whether it is a bare string or an attributed node. */
function textOf(node: unknown): string {
  if (node === undefined || node === null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object') {
    const record = node as Record<string, unknown>
    if ('#text' in record) return String(record['#text'])
  }
  return ''
}

/** "BC12" -> 55 */
function columnIndex(cellRef: string): number {
  const letters = cellRef.match(/^[A-Z]+/)?.[0] ?? 'A'
  let index = 0
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64)
  }
  return index
}

function rowIndex(cellRef: string): number {
  return Number(cellRef.match(/\d+$/)?.[0] ?? 0)
}

function readWorkbook(path: string): Map<string, Grid> {
  const files = unzipSync(new Uint8Array(readFileSync(path)))
  const decoder = new TextDecoder()
  const read = (name: string): string => {
    const entry = files[name] ?? files[name.replace(/^\//, '')]
    if (!entry) throw new Error(`Missing entry in workbook zip: ${name}`)
    return decoder.decode(entry)
  }

  // Shared strings are interned; cells with t="s" hold an index into this table.
  const sharedStrings: string[] = []
  if (files['xl/sharedStrings.xml']) {
    for (const item of asArray(xml.parse(read('xl/sharedStrings.xml')).sst?.si)) {
      const node = item as Record<string, unknown>
      // Rich text splits a single string across multiple <r><t> runs.
      const runs = asArray(node.r as unknown)
      sharedStrings.push(
        runs.length > 0
          ? runs.map((run) => textOf((run as Record<string, unknown>).t)).join('')
          : textOf(node.t),
      )
    }
  }

  // rId -> part name. Targets may be absolute, relative, or "worksheets/…".
  const relationships = new Map<string, string>()
  for (const rel of asArray(xml.parse(read('xl/_rels/workbook.xml.rels')).Relationships?.Relationship)) {
    const node = rel as Record<string, string>
    const target = node['@Target'].replace(/^\//, '')
    relationships.set(node['@Id'], target.startsWith('xl/') ? target : `xl/${target}`)
  }

  const sheets = new Map<string, Grid>()
  for (const sheet of asArray(xml.parse(read('xl/workbook.xml')).workbook?.sheets?.sheet)) {
    const node = sheet as Record<string, string>
    // "r:id" loses its prefix to removeNSPrefix; accept both spellings.
    const part = relationships.get(node['@id'] ?? node['@r:id'])
    if (!part) continue
    sheets.set(node['@name'], readGrid(read(part), sharedStrings))
  }
  return sheets
}

function readGrid(sheetXml: string, sharedStrings: string[]): Grid {
  const grid: Grid = new Map()
  const parsed = xml.parse(sheetXml)

  for (const row of asArray(parsed.worksheet?.sheetData?.row)) {
    const rowNode = row as Record<string, unknown>
    const cols = new Map<number, string>()

    for (const cell of asArray(rowNode.c)) {
      const cellNode = cell as Record<string, unknown>
      const ref = String(cellNode['@r'] ?? '')
      if (!ref) continue

      let text: string
      if (cellNode['@t'] === 's') {
        // Shared string: <v> is an index, not the value.
        text = sharedStrings[Number(textOf(cellNode.v))] ?? ''
      } else if (cellNode['@t'] === 'inlineStr') {
        text = textOf((cellNode.is as Record<string, unknown>)?.t)
      } else {
        // A formula cell keeps its last computed <v>; we want that, not the
        // formula, because the app recomputes everything itself anyway.
        text = textOf(cellNode.v)
      }

      text = text.trim()
      if (text !== '') cols.set(columnIndex(ref), text)
    }

    const number = Number(rowNode['@r'] ?? 0) || rowIndex(String((asArray(rowNode.c)[0] as Record<string, unknown>)?.['@r'] ?? ''))
    if (cols.size > 0 && number > 0) grid.set(number, cols)
  }

  return grid
}

function at(grid: Grid, row: number, col: number): string {
  return grid.get(row)?.get(col) ?? ''
}

/** Row number whose column A equals `heading` (accent- and case-insensitive). */
function findRow(grid: Grid, heading: string): number {
  const target = normalize(heading)
  for (const [rowNumber, cols] of grid) {
    if (normalize(cols.get(1) ?? '') === target) return rowNumber
  }
  throw new Error(`Section not found in spreadsheet: "${heading}"`)
}

/** Row number whose cell in `column` equals `heading`. */
function findRowIn(grid: Grid, heading: string, column: number): number {
  const target = normalize(heading)
  for (const [rowNumber, cols] of grid) {
    if (normalize(cols.get(column) ?? '') === target) return rowNumber
  }
  throw new Error(`Section not found in column ${column}: "${heading}"`)
}

/** Rows of a table starting just below `headerRow`, stopping at the first gap. */
function tableRows(grid: Grid, headerRow: number, columns: number): string[][] {
  const rows: string[][] = []
  for (let row = headerRow + 1; ; row++) {
    const first = at(grid, row, 1)
    if (first === '') break
    rows.push(Array.from({ length: columns }, (_, i) => at(grid, row, i + 1)))
  }
  return rows
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

// ------------------------------------------------------------------- parsing

/** Excel stores dates as a serial number counting from 1899-12-30. */
function serialToIsoDate(serial: number): string {
  return toIsoDate(new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000))
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function asDate(raw: string): string {
  const serial = Number(raw)
  if (Number.isFinite(serial) && serial > 20_000) return serialToIsoDate(serial)
  return raw
}

const DASHES = /[–—-]/
const EMPTY = new Set(['', '—', '-', '–', 'n/a'])

function isEmpty(raw: string): boolean {
  return EMPTY.has(raw.trim().toLowerCase())
}

/** "2" -> 2 · "2–3" -> [2, 3] · "—" -> null */
function parseSets(raw: string): number | [number, number] | null {
  if (isEmpty(raw)) return null
  const numbers = raw.match(/\d+/g)?.map(Number) ?? []
  if (numbers.length === 0) return null
  if (numbers.length === 1) return numbers[0]
  return [numbers[0], numbers[1]]
}

type Target =
  | { kind: 'reps' | 'repsPerSide'; min: number; max: number }
  | { kind: 'seconds' | 'secondsPerSide'; seconds: number }
  | { kind: 'minutes'; min: number; max: number }
  | { kind: 'minutesByPhase'; byPhase: Array<{ min: number; max: number }> }
  | { kind: 'freeform'; text: string }

/**
 * The spreadsheet mixes units in one column, so every shape it actually uses
 * gets its own branch. Anything unrecognised is preserved verbatim rather than
 * coerced into a wrong number.
 */
function parseTarget(raw: string): Target {
  const text = raw.trim()
  const perSide = /\/\s*lado/i.test(text)

  // "25–30 / 30–35 / 35–40 / 35–45 min" — one range per phase
  if (text.includes('/') && /min/i.test(text) && text.split('/').length >= 4) {
    const byPhase = text
      .replace(/min/i, '')
      .split('/')
      .map((chunk) => {
        const [min, max] = numbersIn(chunk)
        return { min, max: max ?? min }
      })
    return { kind: 'minutesByPhase', byPhase }
  }

  if (/min/i.test(text)) {
    const [min, max] = numbersIn(text)
    return { kind: 'minutes', min, max: max ?? min }
  }

  if (/\bs\b|segundo/i.test(text)) {
    const [seconds] = numbersIn(text)
    if (seconds !== undefined) {
      return { kind: perSide ? 'secondsPerSide' : 'seconds', seconds }
    }
  }

  const numbers = numbersIn(text)
  if (numbers.length > 0 && !/ronda/i.test(text)) {
    const [min, max] = numbers
    return { kind: perSide ? 'repsPerSide' : 'reps', min, max: max ?? min }
  }

  return { kind: 'freeform', text }
}

function numbersIn(text: string): number[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.')))
}

type Load = {
  /** Starting working load in kg, when the spreadsheet states one. */
  startKg: number | null
  /** Load is set per side (plate-loaded machines). */
  perSide: boolean
  /** "+5 kg/lado" means 5 kg per side ON TOP of the machine's base or sled. */
  relativeToBase: boolean
  bodyweight: boolean
  /** Load still has to be found in the gym ("Calibrar"). */
  needsCalibration: boolean
  /**
   * Smallest jump for double progression. The spreadsheet never states one —
   * its "Carga inicial" column is a starting load, not an increment — so this
   * stays null and the domain layer falls back to a default. Override it here
   * per exercise once you know what the machine's stack actually allows.
   */
  incrementKg: number | null
  /** Original spreadsheet text, kept so nothing is lost in translation. */
  raw: string
}

function parseLoad(raw: string): Load {
  const text = raw.trim()
  const [value] = numbersIn(text)
  const statesKg = value !== undefined && /kg/i.test(text)

  return {
    startKg: statesKg ? value : null,
    perSide: /\/\s*lado/i.test(text),
    relativeToBase: text.startsWith('+'),
    bodyweight: /corporal/i.test(text),
    needsCalibration: /calibra/i.test(text),
    incrementKg: null,
    raw: isEmpty(text) ? '' : text,
  }
}

/**
 * Exercises that load or challenge the ankle. These prompt for a pain score and
 * are the ones `domain/safety.ts` will refuse to progress on a warning sign.
 */
const ANKLE_PATTERNS = [
  /knee-to-wall/i,
  /tal[oó]n/i,
  /calf/i,
  /equilibrio/i,
  /balance/i,
  /eversi[oó]n/i,
  /dorsiflexi[oó]n/i,
  /step-down/i,
  /prensa/i,
  /reach/i,
]

function isAnkleExercise(name: string): boolean {
  return ANKLE_PATTERNS.some((pattern) => pattern.test(name))
}

/**
 * The spreadsheet names the same movement differently across days ("Elevación
 * de talón" on Monday, "Calf raise" on Wednesday). Progression and the "last
 * time you did this" lookup both key off the exercise id, so variants collapse
 * onto one canonical id while each session keeps its own display name.
 *
 * Deliberately NOT merged:
 *  - "Bicicleta" (8–10 min warm-up) vs the 25–45 min cardio machine session
 *  - "Glute kickback o abducción" — a genuine either/or, merging would mix loads
 */
const CANONICAL_IDS: Record<string, string> = {
  // Variants across the Rutina sheet's session tables.
  'elevacion-de-talon': 'calf-raise',
  'equilibrio-unilateral': 'balance-unilateral',
  'balance-reach': 'balance-unilateral',
  'curl-femoral-acostado-sentado': 'curl-femoral',
  'bici-o-eliptica': 'cardio-machine',
  'bici-eliptica-caminata-estable': 'cardio-machine',
  // Variants used in the Tracker_Gym log, which names things more loosely than
  // the program does. Without these the logged history never reaches the
  // exercise it belongs to.
  'equilibrio-1-pierna': 'balance-unilateral',
  'curl-femoral-acostado': 'curl-femoral',
}

function exerciseId(name: string): string {
  const slug = slugify(name)
  return CANONICAL_IDS[slug] ?? slug
}

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** "10–23 ago" + a reference year -> ISO start/end dates. */
const MONTHS: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
}

function parseDateRange(raw: string, year: number): { start: string; end: string | null } {
  // "10–23 ago" · "24 ago–4 oct" · "16 nov–defensa"
  const [rawStart, rawEnd] = raw.split(DASHES).map((part) => part.trim())
  const trailingMonth = monthIn(rawEnd ?? '') ?? monthIn(rawStart) ?? 1

  const start = buildDate(rawStart, monthIn(rawStart) ?? trailingMonth, year)
  const end = rawEnd && !/defensa/i.test(rawEnd)
    ? buildDate(rawEnd, monthIn(rawEnd) ?? trailingMonth, year)
    : null

  return { start, end }
}

function monthIn(text: string): number | undefined {
  const match = text.match(/[a-záéíóú]{3}/i)
  return match ? MONTHS[normalize(match[0])] : undefined
}

function buildDate(text: string, month: number, year: number): string {
  const [day] = numbersIn(text)
  return `${year}-${String(month).padStart(2, '0')}-${String(day ?? 1).padStart(2, '0')}`
}

// ------------------------------------------------------------------ sections

const WEEKDAY_BY_NAME: Record<string, string> = {
  lunes: 'monday',
  martes: 'tuesday',
  miercoles: 'wednesday',
  jueves: 'thursday',
  viernes: 'friday',
  sabado: 'saturday',
  domingo: 'sunday',
}

/** Session tables in the Rutina sheet, keyed by their header text. */
const SESSION_SECTIONS = [
  { heading: 'FULL BODY A · LUNES', id: 'full_body_a', name: 'Full Body A', weekday: 'monday' },
  { heading: 'CARDIO + CORE · MARTES', id: 'cardio_core', name: 'Cardio + core', weekday: 'tuesday' },
  { heading: 'FULL BODY B · MIÉRCOLES', id: 'full_body_b', name: 'Full Body B', weekday: 'wednesday' },
  { heading: 'CARDIO + TOBILLO · JUEVES', id: 'cardio_ankle', name: 'Cardio + tobillo', weekday: 'thursday' },
  { heading: 'FULL BODY C · VIERNES', id: 'full_body_c', name: 'Full Body C', weekday: 'friday' },
] as const

function buildProgram(dashboard: Grid, routine: Grid) {
  const startDate = asDate(at(dashboard, 4, 2))
  const checkpointDate = asDate(at(dashboard, 5, 2))
  const year = Number(startDate.slice(0, 4))

  const phases = tableRows(routine, findRow(routine, 'Fase'), 10)
    .filter((row) => /^fase/i.test(row[0]))
    .map((row, index) => {
      const { start, end } = parseDateRange(row[1], year)
      const [rirMin, rirMax] = numbersIn(row[5])
      return {
        id: index + 1,
        name: row[0].replace(/^fase\s*\d+\s*·\s*/i, '').trim(),
        startDate: start,
        endDate: end,
        goal: row[2],
        mainSets: parseSets(row[3]),
        accessorySets: parseSets(row[4]),
        targetRir: { min: rirMin, max: rirMax ?? rirMin },
        weeklyCardioMinutes: (() => {
          const [min, max] = numbersIn(row[6])
          return { min, max: max ?? min }
        })(),
        coreFrequency: row[7],
        ankleStage: row[8],
        advanceCriteria: row[9],
      }
    })

  const weekStructure = tableRows(routine, findRow(routine, 'Día'), 10)
    .filter((row) => WEEKDAY_BY_NAME[normalize(row[0])])
    .map((row) => ({
      weekday: WEEKDAY_BY_NAME[normalize(row[0])],
      block: row[1],
      focus: row[2],
      hasStrength: /^s[ií]$/i.test(row[3]),
      cardio: isEmpty(row[4]) ? null : row[4],
      hasCore: /^s[ií]$/i.test(row[5]),
      hasAnkle: /^s[ií]$/i.test(row[6]),
      intensity: row[7],
      notes: row[8],
    }))

  const sessions = SESSION_SECTIONS.map(({ heading, ...session }) => {
    const headerRow = findRow(routine, heading) + 1
    const exercises = tableRows(routine, headerRow, 10)
      .filter((row) => /^\d+$/.test(row[0]))
      .map((row) => {
        const name = row[1]
        return {
          id: exerciseId(name),
          name,
          order: Number(row[0]),
          setsByPhase: {
            1: parseSets(row[2]),
            2: parseSets(row[3]),
            3: parseSets(row[4]),
            4: parseSets(row[5]),
          },
          target: parseTarget(row[6]),
          load: parseLoad(row[7]),
          progression: row[8],
          goal: row[9],
          isAnkle: isAnkleExercise(name),
        }
      })

    return { ...session, exercises }
  })

  // The Dashboard sheet states what the program is for and the rules it runs by.
  // Both belong with the program rather than being reinvented in the interface.
  const objectives = tableRows(dashboard, findRowIn(dashboard, 'Objetivo', 4), 8)
    .filter((row) => row[3] !== '')
    .map((row) => ({
      objective: row[3],
      target: row[4],
      measuredBy: row[5],
      frequency: row[6],
      priority: row[7],
    }))

  const keyRules = tableRows(dashboard, findRowIn(dashboard, 'REGLAS CLAVE', 10), 12)
    .filter((row) => row[10] !== '' && row[11] !== '')
    .map((row) => ({ rule: row[10], detail: row[11] }))

  const progressionRules = tableRows(routine, findRow(routine, 'Regla'), 2).map((row) => ({
    rule: row[0],
    detail: row[1],
  }))

  return {
    meta: {
      title: 'Operación Tesis',
      startDate,
      checkpointDate,
      startWeightKg: Number(at(dashboard, 7, 2)) || null,
      generatedFrom: 'operacion_tesis_tracker_v2.xlsx',
    },
    phases,
    weekStructure,
    sessions,
    objectives,
    keyRules,
    progressionRules,
  }
}

function buildAnkleProtocol(ankle: Grid) {
  const baselineHeading = (at(ankle, 4, 1) || '').trim()
  const baselineDate = baselineHeading.match(/(\d{2})\/(\d{2})\/(\d{4})/)

  const baseline = tableRows(ankle, findRow(ankle, 'Métrica'), 5).map((row) => ({
    metric: row[0],
    result: row[1],
    interpretation: row[2],
    initialGoal: row[3],
    notes: row[4],
  }))

  const protocol = tableRows(ankle, findRow(ankle, 'Fase'), 10).map((row) => ({
    stage: row[0],
    weeks: row[1],
    exercise: row[2],
    sets: parseSets(row[3]),
    target: parseTarget(row[4]),
    frequency: row[5],
    progression: row[6],
    stopSignal: row[7],
    goal: row[8],
    notes: row[9],
  }))

  const safetyRow = findRow(ankle, '⚠️ Seguridad')
  const safetyNotes = [at(ankle, safetyRow + 1, 1), at(ankle, safetyRow + 2, 1)].filter(Boolean)

  return {
    baselineDate: baselineDate
      ? `${baselineDate[3]}-${baselineDate[2]}-${baselineDate[1]}`
      : null,
    baseline,
    protocol,
    safetyNotes,
  }
}

function buildSources(sources: Grid) {
  const references = tableRows(sources, findRow(sources, 'Fuente'), 4).map((row) => ({
    source: row[0],
    supports: row[1],
    reference: row[2],
    url: row[3],
  }))

  const collect = (heading: string) => {
    const start = findRow(sources, heading)
    const lines: string[] = []
    for (let row = start + 1; ; row++) {
      const text = at(sources, row, 1)
      if (text === '') break
      lines.push(text)
    }
    return lines
  }

  return {
    references,
    notes: collect('Notas importantes'),
    programCriteria: collect('Criterio del programa'),
  }
}

/** The 8-Aug session, converted into the app's own SetLog shape. */
function buildFirstSession(gym: Grid) {
  const headerRow = findRow(gym, 'Fecha')
  const rows = tableRows(gym, headerRow, 15)
  if (rows.length === 0) return null

  const date = asDate(rows[0][0])
  const sets: unknown[] = []

  for (const row of rows) {
    const exerciseName = row[2]
    if (!exerciseName) continue
    const id = exerciseId(exerciseName)
    const anklePain = row[11] === '' ? null : Number(row[11])
    const rir = row[10] === '' ? null : row[10]

    // Columns E/F, G/H, I/J hold up to three load+reps pairs.
    const pairs: Array<[string, string]> = [
      [row[4], row[5]],
      [row[6], row[7]],
      [row[8], row[9]],
    ]

    pairs.forEach(([load, reps], index) => {
      if (isEmpty(load) && isEmpty(reps)) return
      const [loadValue] = numbersIn(load)
      sets.push({
        exerciseId: id,
        exerciseName,
        setNumber: index + 1,
        load: /corporal|lesionado|sano/i.test(load) ? null : (loadValue ?? null),
        unit: /corporal/i.test(load) ? 'bodyweight' : loadValue !== undefined ? 'kg' : 'bodyweight',
        loadRaw: load,
        reps: numbersIn(reps)[0] ?? null,
        rir,
        anklePain: Number.isFinite(anklePain) ? anklePain : null,
        note: row[13] || null,
      })
    })

    if (pairs.every(([load, reps]) => isEmpty(load) && isEmpty(reps))) {
      sets.push({
        exerciseId: id,
        exerciseName,
        setNumber: 1,
        load: null,
        unit: 'bodyweight',
        loadRaw: row[3],
        reps: null,
        rir,
        anklePain: Number.isFinite(anklePain) ? anklePain : null,
        note: row[13] || null,
      })
    }
  }

  return { date, type: 'full_body_a', phase: 1, completed: true, sets }
}

// ---------------------------------------------------------------------- main

function main(): void {
  if (!existsSync(WORKBOOK)) {
    throw new Error(
      `Spreadsheet not found at ${WORKBOOK}.\n` +
        'It is gitignored on purpose — restore your own copy before importing.',
    )
  }

  const workbook = readWorkbook(WORKBOOK)

  const sheet = (name: string): Grid => {
    const worksheet = workbook.get(name)
    if (!worksheet) {
      throw new Error(
        `Missing worksheet "${name}". Found: ${[...workbook.keys()].join(', ')}`,
      )
    }
    return worksheet
  }

  const program = buildProgram(sheet('Dashboard'), sheet('Rutina'))
  const ankleProtocol = buildAnkleProtocol(sheet('Tobillo'))
  const sources = buildSources(sheet('Fuentes'))
  const firstSession = buildFirstSession(sheet('Tracker_Gym'))

  mkdirSync(OUT_DIR, { recursive: true })
  const write = (file: string, data: unknown) => {
    const path = resolve(OUT_DIR, file)
    const body = file.endsWith('.json')
      ? `${JSON.stringify(data, null, 2)}\n`
      : `# Generated by scripts/import-excel.ts — edit freely, it is not regenerated automatically.\n${stringify(data, { lineWidth: 100 })}`
    writeFileSync(path, body, 'utf8')
    return path
  }

  write('program.yaml', program)
  write('ankle-protocol.yaml', ankleProtocol)
  write('sources.yaml', sources)
  if (firstSession) write('first-session.json', firstSession)

  const exerciseCount = program.sessions.reduce((sum, s) => sum + s.exercises.length, 0)
  console.log('Imported into content/')
  console.log(`  phases            ${program.phases.length}`)
  console.log(`  sessions          ${program.sessions.length}`)
  console.log(`  exercises         ${exerciseCount}`)
  console.log(`  ankle protocol    ${ankleProtocol.protocol.length} steps`)
  console.log(`  sources           ${sources.references.length}`)
  console.log(`  seeded sets       ${firstSession?.sets.length ?? 0} (${firstSession?.date})`)
}

try {
  main()
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
