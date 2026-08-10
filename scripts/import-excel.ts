/**
 * One-shot importer: turns the original spreadsheet into the structured content
 * the app reads at runtime.
 *
 *   operacion_tesis_tracker_v3_auditado.xlsx
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
import { resolveExerciseId } from '../src/domain/exercise-ids.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WORKBOOK = resolve(ROOT, 'operacion_tesis_tracker_v3_auditado.xlsx')
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

// ------------------------------------------------------------------- sections

/**
 * Finds a numbered section by the words in its title rather than its position.
 * v3 renumbered and reordered everything relative to v2; matching on "FULL BODY
 * A" survives that, and survives the next reshuffle too.
 */
function findSection(grid: Grid, pattern: RegExp): number {
  for (const [rowNumber, cols] of grid) {
    const title = cols.get(1) ?? ''
    if (pattern.test(normalize(title))) return rowNumber
  }
  throw new Error(`Section not found: ${pattern}`)
}

/** Column index of a header, by its label, within the header row of a section. */
function columnsOf(grid: Grid, headerRow: number): Map<string, number> {
  const map = new Map<string, number>()
  for (const [col, value] of grid.get(headerRow) ?? []) {
    map.set(normalize(value), col)
  }
  return map
}

/**
 * Reads a section's table as objects keyed by header label, so a column moving
 * left or right between versions changes nothing here.
 */
function readTable(grid: Grid, titleRow: number): Array<Map<string, string>> {
  const headerRow = titleRow + 1
  const columns = columnsOf(grid, headerRow)
  const rows: Array<Map<string, string>> = []

  for (let row = headerRow + 1; ; row++) {
    const first = at(grid, row, 1)
    if (first === '') break
    const record = new Map<string, string>()
    for (const [label, col] of columns) record.set(label, at(grid, row, col))
    rows.push(record)
  }
  return rows
}

const get = (row: Map<string, string>, ...labels: string[]): string => {
  for (const label of labels) {
    const value = row.get(normalize(label))
    if (value !== undefined && value !== '') return value
  }
  return ''
}

// ------------------------------------------------------------------- parsing

const DASHES = /[–—-]/
const EMPTY = new Set(['', '—', '-', '–', 'n/a'])
const isEmpty = (raw: string) => EMPTY.has(raw.trim().toLowerCase())

function numbersIn(text: string): number[] {
  return (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.')))
}

type Range = { min: number; max: number } | null

/** "2", "2–3", "2; 3 solo en prioridad" -> a range. "—" -> null. */
function parseRange(raw: string): Range {
  if (isEmpty(raw)) return null
  const numbers = numbersIn(raw)
  if (numbers.length === 0) return null
  return { min: numbers[0], max: numbers[1] ?? numbers[0] }
}

/** "90–120 s" -> {min:90,max:120}. v3 states rest per exercise; v2 never did. */
function parseRest(raw: string): Range {
  if (isEmpty(raw) || !/s|seg|min/i.test(raw)) return null
  const numbers = numbersIn(raw)
  if (numbers.length === 0) return null
  const scale = /min/i.test(raw) ? 60 : 1
  return { min: numbers[0] * scale, max: (numbers[1] ?? numbers[0]) * scale }
}

/** The RIR column carries RPE for warm-ups, which is a different scale. */
function parseRir(raw: string): Range {
  if (/rpe/i.test(raw)) return null
  return parseRange(raw)
}

type Target =
  | { kind: 'reps' | 'repsPerSide'; min: number; max: number }
  | { kind: 'seconds' | 'secondsPerSide'; seconds: number }
  | { kind: 'minutes'; min: number; max: number }
  | { kind: 'rounds'; text: string }
  | { kind: 'freeform'; text: string }

function parseTarget(raw: string): Target {
  const text = raw.trim()
  const perSide = /\/\s*lado/i.test(text)

  if (/min/i.test(text)) {
    const [min, max] = numbersIn(text)
    return { kind: 'minutes', min, max: max ?? min }
  }
  if (/ronda/i.test(text)) return { kind: 'rounds', text }
  if (/\bs\b|segundo/i.test(text)) {
    const [seconds] = numbersIn(text)
    if (seconds !== undefined) return { kind: perSide ? 'secondsPerSide' : 'seconds', seconds }
  }
  const numbers = numbersIn(text)
  if (numbers.length > 0) {
    const [min, max] = numbers
    return { kind: perSide ? 'repsPerSide' : 'reps', min, max: max ?? min }
  }
  return { kind: 'freeform', text }
}

type Load = {
  startKg: number | null
  perSide: boolean
  relativeToBase: boolean
  bodyweight: boolean
  needsCalibration: boolean
  incrementKg: number | null
  raw: string
}

function parseLoad(raw: string): Load {
  const text = raw.trim()
  const [value] = numbersIn(text)
  const statesKg = value !== undefined && /kg/i.test(text)
  return {
    startKg: statesKg ? value : null,
    perSide: /\/\s*lado/i.test(text),
    // "+5 kg/lado" is 5 kg per side on top of the sled, not an increment.
    relativeToBase: text.startsWith('+'),
    bodyweight: /corporal/i.test(text),
    needsCalibration: /calibra/i.test(text),
    // v3 states rest but still never states the smallest jump a machine allows.
    incrementKg: null,
    raw: isEmpty(text) ? '' : text,
  }
}

const MONTHS: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
}

function monthIn(text: string): number | undefined {
  const match = text.match(/[a-záéíóú]{3}/i)
  return match ? MONTHS[normalize(match[0])] : undefined
}

function parseDateRange(raw: string, year: number): { start: string; end: string | null } {
  const [rawStart, rawEnd] = raw.split(DASHES).map((part) => part.trim())
  const trailing = monthIn(rawEnd ?? '') ?? monthIn(rawStart) ?? 1
  const build = (text: string, month: number) => {
    const [day] = numbersIn(text)
    return `${year}-${String(month).padStart(2, '0')}-${String(day ?? 1).padStart(2, '0')}`
  }
  return {
    start: build(rawStart, monthIn(rawStart) ?? trailing),
    end: rawEnd && !/defensa/i.test(rawEnd) ? build(rawEnd, monthIn(rawEnd) ?? trailing) : null,
  }
}

const WEEKDAY_BY_NAME: Record<string, string> = {
  lunes: 'monday', martes: 'tuesday', miercoles: 'wednesday', jueves: 'thursday',
  viernes: 'friday', sabado: 'saturday', domingo: 'sunday',
}

/**
 * Exercises the ankle carries load through, which prompt for a pain score and
 * are gated by the safety rules. Everything in the rehab section qualifies; in
 * the strength sessions only the leg press does, because it is the one movement
 * that drives through the ankle under load.
 */
const ANKLE_IN_STRENGTH = new Set(['leg_press'])

/** Names the spreadsheet used that no canonical id claims. Reported, never guessed. */
const unmapped: Array<{ section: string; name: string }> = []

function idFor(section: string, name: string): string | null {
  const id = resolveExerciseId(name)
  if (!id) unmapped.push({ section, name })
  return id
}

// -------------------------------------------------------------------- program

const SESSION_SECTIONS = [
  { pattern: /full body a/, id: 'full_body_a', name: 'Full Body A', weekday: 'monday' },
  { pattern: /full body b/, id: 'full_body_b', name: 'Full Body B', weekday: 'wednesday' },
  { pattern: /full body c/, id: 'full_body_c', name: 'Full Body C', weekday: 'friday' },
] as const

function buildProgram(dashboard: Grid, routine: Grid) {
  const startDate = asDate(at(dashboard, 4, 2))
  const checkpointDate = asDate(at(dashboard, 5, 2))
  const year = Number(startDate.slice(0, 4))

  const phases = readTable(routine, findSection(routine, /fases/))
    .filter((row) => /^\d/.test(get(row, 'Fase')))
    .map((row, index) => {
      const { start, end } = parseDateRange(get(row, 'Fechas'), year)
      return {
        id: index + 1,
        name: get(row, 'Fase').replace(/^\d+\s*·\s*/, '').trim(),
        startDate: start,
        endDate: end,
        goal: get(row, 'Objetivo'),
        workingSets: rangeToSets(parseRange(get(row, 'Series de trabajo'))),
        targetRir: parseRir(get(row, 'RIR objetivo')) ?? { min: 2, max: 2 },
        weeklyCardioMinutes: parseRange(get(row, 'Cardio semanal')) ?? { min: 0, max: 0 },
        coreWeeklySets: get(row, 'Abdomen'),
        ankleStage: get(row, 'Tobillo'),
        progresses: get(row, 'Qué progresa'),
        avoid: get(row, 'Qué NO hacemos'),
      }
    })

  const weekStructure = readTable(routine, findSection(routine, /estructura semanal/))
    .filter((row) => WEEKDAY_BY_NAME[normalize(get(row, 'Día'))])
    .map((row) => ({
      weekday: WEEKDAY_BY_NAME[normalize(get(row, 'Día'))],
      block: get(row, 'Sesión'),
      focus: get(row, 'Prioridad'),
      hasStrength: /^s[ií]$/i.test(get(row, 'Fuerza')),
      cardio: isEmpty(get(row, 'Cardio')) ? null : get(row, 'Cardio'),
      hasCore: /^s[ií]$/i.test(get(row, 'Core')),
      hasAnkle: /^s[ií]$/i.test(get(row, 'Rehab tobillo')),
      duration: get(row, 'Duración aprox.', 'Duración'),
      notes: '',
    }))

  const sessions = SESSION_SECTIONS.map((section) => {
    const rows = readTable(routine, findSection(routine, section.pattern))
    const exercises = rows
      .filter((row) => /^\d+$/.test(get(row, 'Orden')))
      .map((row) => {
        const name = get(row, 'Ejercicio')
        const id = idFor(section.name, name)
        if (!id) return null

        // v3 states sets twice: phase 1, then a single figure for phases 2–4.
        const f1 = parseRange(get(row, 'Series F1'))
        const later = parseRange(get(row, 'Series F2–4', 'Series F2-4')) ?? f1

        return {
          id,
          name,
          order: Number(get(row, 'Orden')),
          muscle: get(row, 'Músculo/patrón'),
          setsByPhase: { 1: rangeToSets(f1), 2: rangeToSets(later), 3: rangeToSets(later), 4: rangeToSets(later) },
          target: parseTarget(get(row, 'Reps')),
          load: parseLoad(get(row, 'Carga inicial')),
          rir: parseRir(get(row, 'RIR')),
          restSeconds: parseRest(get(row, 'Descanso')),
          substitution: get(row, 'Sustitución válida', 'Sustitución'),
          technique: get(row, 'Nota técnica'),
          goal: get(row, 'Por qué está'),
          progression: 'Doble progresión',
          isAnkle: ANKLE_IN_STRENGTH.has(id),
        }
      })
      .filter((exercise): exercise is NonNullable<typeof exercise> => exercise !== null)

    return { id: section.id, name: section.name, weekday: section.weekday, exercises }
  })

  const cardio = readTable(routine, findSection(routine, /cardio/))
    .filter((row) => /^f\d$/i.test(get(row, 'Fase')))
    .map((row) => ({
      phase: Number(get(row, 'Fase').replace(/\D/g, '')),
      tuesday: parseRange(get(row, 'Martes')),
      thursday: parseRange(get(row, 'Jueves')),
      saturday: parseRange(get(row, 'Sábado')),
      weeklyTotal: parseRange(get(row, 'Total objetivo')),
      modality: get(row, 'Modalidad'),
      intensity: get(row, 'Intensidad'),
      progression: get(row, 'Progresión'),
      avoid: get(row, 'Evitar al inicio'),
      reduceWhen: get(row, 'Señal para reducir'),
    }))

  /**
   * Ankle work is its own programme now, staged by rehab week rather than folded
   * into the strength days. v2 mixed it in and that is exactly what made it
   * invisible whenever a Full Body session was rearranged.
   */
  const ankleRehab = readTable(routine, findSection(routine, /rehabilitacion tobillo/))
    .filter((row) => /sem/i.test(get(row, 'Fase')))
    .map((row) => {
      const name = get(row, 'Ejercicio')
      const id = idFor('Rehabilitación tobillo', name)
      return id === null ? null : {
        id,
        name,
        stage: get(row, 'Fase'),
        weeks: parseRange(get(row, 'Fase')),
        sets: rangeToSets(parseRange(get(row, 'Series'))),
        target: parseTarget(get(row, 'Reps/tiempo')),
        frequency: get(row, 'Frecuencia'),
        progression: get(row, 'Progresión'),
        goal: get(row, 'Objetivo'),
        baseline: get(row, 'Baseline'),
        painAllowed: get(row, 'Dolor permitido'),
        substitution: get(row, 'Sustitución'),
        advanceCriteria: get(row, 'Criterio avance'),
        technique: get(row, 'Notas'),
        isAnkle: true,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  const progressionRules = readTable(routine, findSection(routine, /reglas de progresion/)).map(
    (row) => ({ rule: get(row, 'Regla'), detail: get(row, 'Aplicación'), example: get(row, 'Ejemplo') }),
  )

  const objectives = readTable(dashboard, findRowIn(dashboard, 'Objetivo', 4) - 1)
  void objectives

  return {
    meta: {
      title: 'Operación Tesis',
      startDate,
      checkpointDate,
      startWeightKg: Number(at(dashboard, 7, 2)) || null,
      generatedFrom: 'operacion_tesis_tracker_v3_auditado.xlsx',
    },
    phases,
    weekStructure,
    sessions,
    cardio,
    ankleRehab,
    progressionRules,
  }
}

/** A set count as the app stores it: a number, a range, or not programmed. */
function rangeToSets(range: Range): number | [number, number] | null {
  if (range === null) return null
  return range.min === range.max ? range.min : [range.min, range.max]
}

// ------------------------------------------------------------------- the rest

/** Excel stores dates as a serial number counting from 1899-12-30. */
function serialToIsoDate(serial: number): string {
  return toIsoDate(new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000))
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function asDate(raw: string): string {
  const serial = Number(raw)
  return Number.isFinite(serial) && serial > 20_000 ? serialToIsoDate(serial) : raw
}

/** The Dashboard's own statement of what the programme is for. */
function buildDashboardExtras(dashboard: Grid) {
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

  return { objectives, keyRules }
}

function buildAnkleBaseline(ankle: Grid) {
  const heading = at(ankle, findRow(ankle, 'Métrica') - 1, 1)
  const date = heading.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return {
    baselineDate: date ? `${date[3]}-${date[2]}-${date[1]}` : null,
    baseline: tableRows(ankle, findRow(ankle, 'Métrica'), 5).map((row) => ({
      metric: row[0],
      result: row[1],
      interpretation: row[2],
      initialGoal: row[3],
      notes: row[4],
    })),
    safetyNotes: (() => {
      const start = findRow(ankle, '⚠️ Seguridad')
      const lines: string[] = []
      for (let row = start + 1; at(ankle, row, 1) !== ''; row++) lines.push(at(ankle, row, 1))
      return lines
    })(),
  }
}

function buildSources(sources: Grid) {
  const collect = (heading: string) => {
    const start = findRow(sources, heading)
    const lines: string[] = []
    for (let row = start + 1; at(sources, row, 1) !== ''; row++) lines.push(at(sources, row, 1))
    return lines
  }
  return {
    references: tableRows(sources, findRow(sources, 'Fuente'), 4).map((row) => ({
      source: row[0],
      supports: row[1],
      reference: row[2],
      url: row[3],
    })),
    notes: collect('Notas importantes'),
    programCriteria: collect('Criterio del programa'),
  }
}


/**
 * The baseline session from the Tracker_Gym sheet, in the app's own shape.
 *
 * Exercise ids go through the canonical registry, same as the programme, so the
 * seeded history files under the same identity as everything logged since.
 */
function buildFirstSession(gym: Grid) {
  const headerRow = findRow(gym, 'Fecha')
  const rows = tableRows(gym, headerRow, 15)
  if (rows.length === 0) return null

  const date = asDate(rows[0][0])
  const sets: unknown[] = []

  for (const row of rows) {
    const name = row[2]
    if (!name) continue
    const id = idFor('Tracker_Gym', name)
    if (!id) continue

    const anklePain = row[11] === '' ? null : Number(row[11])
    const pairs: Array<[string, string]> = [[row[4], row[5]], [row[6], row[7]], [row[8], row[9]]]
    const measured = pairs.filter(([load, reps]) => !isEmpty(load) || !isEmpty(reps))

    const push = (load: string, reps: string, index: number) => {
      const [value] = numbersIn(load)
      sets.push({
        exerciseId: id,
        exerciseName: name,
        setNumber: index + 1,
        load: /corporal|lesionado|sano/i.test(load) ? null : (value ?? null),
        unit: /corporal/i.test(load) ? 'bodyweight' : value !== undefined ? 'kg' : 'bodyweight',
        loadRaw: load,
        reps: numbersIn(reps)[0] ?? null,
        rir: row[10] === '' ? null : row[10],
        anklePain: Number.isFinite(anklePain) ? anklePain : null,
        note: row[13] || null,
      })
    }

    if (measured.length > 0) measured.forEach(([load, reps], i) => push(load, reps, i))
    // A row with only a note still belongs in the log; the note is the data.
    else push('', '', 0)
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
      throw new Error(`Missing worksheet "${name}". Found: ${[...workbook.keys()].join(', ')}`)
    }
    return worksheet
  }

  const program = {
    ...buildProgram(sheet('Dashboard'), sheet('Rutina')),
    ...buildDashboardExtras(sheet('Dashboard')),
  }
  const ankleProtocol = {
    ...buildAnkleBaseline(sheet('Tobillo')),
    protocol: program.ankleRehab,
  }
  const sources = buildSources(sheet('Fuentes'))
  const firstSession = buildFirstSession(sheet('Tracker_Gym'))

  mkdirSync(OUT_DIR, { recursive: true })
  const write = (file: string, data: unknown) => {
    const body = file.endsWith('.json')
      ? `${JSON.stringify(data, null, 2)}\n`
      : `# Generated by scripts/import-excel.ts — edit freely, it is not regenerated automatically.\n${stringify(data, { lineWidth: 100 })}`
    writeFileSync(resolve(OUT_DIR, file), body, 'utf8')
  }

  write('program.yaml', program)
  write('ankle-protocol.yaml', ankleProtocol)
  write('sources.yaml', sources)
  if (firstSession) write('first-session.json', firstSession)

  const exercises = program.sessions.reduce((sum, s) => sum + s.exercises.length, 0)
  console.log('Imported into content/')
  console.log(`  phases            ${program.phases.length}`)
  console.log(`  sessions          ${program.sessions.length}`)
  console.log(`  exercises         ${exercises}`)
  console.log(`  cardio phases     ${program.cardio.length}`)
  console.log(`  ankle rehab       ${program.ankleRehab.length} steps`)
  console.log(`  objectives        ${program.objectives.length}`)
  console.log(`  sources           ${sources.references.length}`)
  console.log(`  seeded sets       ${firstSession?.sets.length ?? 0} (${firstSession?.date})`)

  if (unmapped.length > 0) {
    console.log('\n  ⚠️  Sin id canónico — revisar antes de confiar en el historial:')
    for (const { section, name } of unmapped) console.log(`     ${section}: "${name}"`)
    console.log('\n  Añádelos a EXERCISE_REGISTRY en src/domain/exercise-ids.ts.')
  } else {
    console.log('\n  ✅ Todos los ejercicios resolvieron a un id canónico.')
  }
}

try {
  main()
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
