/**
 * Checks the generated content against the spreadsheet it came from.
 *
 * Reads the workbook again, independently of the importer, and compares what
 * ended up in `content/` against what the sheet says. An importer that quietly
 * drops a column produces a plausible-looking file; the only way to know is to
 * compare against the source rather than against expectations.
 *
 * Run with: npm run verify:import
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { XMLParser } from 'fast-xml-parser'
import { unzipSync } from 'fflate'
import { parse } from 'yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const xml = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@', removeNSPrefix: true,
  parseTagValue: false, parseAttributeValue: false,
})
const arr = <T,>(v: unknown): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? (v as T[]) : [v as T])
const text = (n: unknown): string =>
  n == null ? '' : typeof n === 'object' ? ('#text' in (n as object) ? String((n as Record<string, unknown>)['#text']) : '') : String(n)

function sheetRows(path: string, wanted: string): Map<number, Map<string, string>> {
  const files = unzipSync(new Uint8Array(readFileSync(path)))
  const dec = new TextDecoder()
  const ss: string[] = []
  const shared = xml.parse(dec.decode(files['xl/sharedStrings.xml'])).sst?.si
  for (const si of arr<Record<string, unknown>>(shared)) {
    const runs = arr<Record<string, unknown>>(si.r)
    ss.push(runs.length ? runs.map((r) => text(r.t)).join('') : text(si.t))
  }
  const rels = new Map<string, string>()
  for (const r of arr<Record<string, string>>(xml.parse(dec.decode(files['xl/_rels/workbook.xml.rels'])).Relationships?.Relationship)) {
    rels.set(r['@Id'], r['@Target'].replace(/^\//, ''))
  }
  const out = new Map<number, Map<string, string>>()
  for (const sh of arr<Record<string, string>>(xml.parse(dec.decode(files['xl/workbook.xml'])).workbook?.sheets?.sheet)) {
    if (sh['@name'] !== wanted) continue
    const rows = xml.parse(dec.decode(files[rels.get(sh['@id']) as string])).worksheet?.sheetData?.row
    for (const row of arr<Record<string, unknown>>(rows)) {
      const cells = new Map<string, string>()
      for (const c of arr<Record<string, unknown>>(row.c)) {
        const ref = String(c['@r'] ?? ''); if (!ref) continue
        const value =
          c['@t'] === 's' ? (ss[Number(text(c.v))] ?? '')
          : c['@t'] === 'inlineStr' ? text((c.is as Record<string, unknown>)?.t)
          : text(c.v)
        if (value.trim()) cells.set(ref.match(/^[A-Z]+/)?.[0] ?? '', value.trim())
      }
      if (cells.size) out.set(Number(row['@r']), cells)
    }
  }
  return out
}

const routine = sheetRows(resolve(ROOT, 'operacion_tesis_tracker_v3_auditado.xlsx'), 'Rutina')
const program = parse(readFileSync(resolve(ROOT, 'content/program.yaml'), 'utf8'))

let checks = 0
let failures = 0
const fail = (message: string) => { failures++; console.log(`  ✗ ${message}`) }
const check = (ok: boolean, message: string) => { checks++; if (!ok) fail(message) }

/** Rows of a numbered section, read straight from the sheet. */
function sectionRows(pattern: RegExp) {
  const start = [...routine].find(([, c]) => pattern.test((c.get('A') ?? '').toLowerCase()))?.[0]
  if (start === undefined) throw new Error(`sección no encontrada: ${pattern}`)
  const rows: Array<Map<string, string>> = []
  for (let r = start + 2; routine.has(r) && /^\d+$/.test(routine.get(r)?.get('A') ?? ''); r++) {
    rows.push(routine.get(r) as Map<string, string>)
  }
  return rows
}

console.log('Verificando content/program.yaml contra el Excel\n')

for (const [pattern, sessionId] of [
  [/full body a/, 'full_body_a'],
  [/full body b/, 'full_body_b'],
  [/full body c/, 'full_body_c'],
] as const) {
  const sheetExercises = sectionRows(pattern)
  const imported = program.sessions.find((s: { id: string }) => s.id === sessionId)

  console.log(`${imported.name}: ${imported.exercises.length} ejercicios`)
  check(
    sheetExercises.length === imported.exercises.length,
    `${sessionId}: el Excel tiene ${sheetExercises.length}, el import ${imported.exercises.length}`,
  )

  sheetExercises.forEach((row, index) => {
    const got = imported.exercises[index]
    if (!got) return fail(`${sessionId}: falta el ejercicio ${index + 1}`)
    const name = row.get('B') ?? ''

    check(got.name === name, `${sessionId} #${index + 1}: nombre "${got.name}" ≠ "${name}"`)
    check(String(got.order) === row.get('A'), `${name}: orden ${got.order} ≠ ${row.get('A')}`)

    // Sets: F1 drives phase 1, F2–4 the rest.
    const f1 = Number(row.get('D')); const later = Number(row.get('E'))
    check(got.setsByPhase['1'] === f1, `${name}: series F1 ${got.setsByPhase['1']} ≠ ${f1}`)
    check(got.setsByPhase['2'] === later, `${name}: series F2 ${got.setsByPhase['2']} ≠ ${later}`)
    check(got.setsByPhase['4'] === later, `${name}: series F4 ${got.setsByPhase['4']} ≠ ${later}`)

    // Reps, as written.
    const reps = row.get('F') ?? ''
    const repNumbers = (reps.match(/\d+/g) ?? []).map(Number)
    if (got.target.kind === 'reps' || got.target.kind === 'repsPerSide') {
      check(got.target.min === repNumbers[0], `${name}: reps mín ${got.target.min} ≠ ${repNumbers[0]}`)
      check(got.target.max === (repNumbers[1] ?? repNumbers[0]), `${name}: reps máx ${got.target.max}`)
    }

    // Rest, which v3 states per exercise and the timer now uses.
    const rest = row.get('I') ?? ''
    const restNumbers = (rest.match(/\d+/g) ?? []).map(Number)
    if (restNumbers.length > 0) {
      check(got.restSeconds?.min === restNumbers[0], `${name}: descanso mín ${got.restSeconds?.min} ≠ ${restNumbers[0]}`)
      check(got.restSeconds?.max === (restNumbers[1] ?? restNumbers[0]), `${name}: descanso máx`)
    } else {
      check(got.restSeconds === null, `${name}: descanso debería ser nulo`)
    }

    // RIR, ignoring the warm-up rows that state RPE instead.
    const rir = row.get('H') ?? ''
    if (!/rpe/i.test(rir)) {
      const rirNumbers = (rir.match(/\d+/g) ?? []).map(Number)
      check(got.rir?.min === rirNumbers[0], `${name}: RIR mín ${got.rir?.min} ≠ ${rirNumbers[0]}`)
    } else {
      check(got.rir === null, `${name}: RIR debería ser nulo (la hoja dice RPE)`)
    }

    check((got.substitution ?? '') === (row.get('K') ?? ''), `${name}: sustitución no coincide`)
    check((got.muscle ?? '') === (row.get('C') ?? ''), `${name}: músculo no coincide`)
  })
}

// Ankle rehab: its own programme, staged by week.
const rehabSheet = [...routine]
  .filter(([, c]) => /^sem/i.test(c.get('A') ?? '') && (c.get('B') ?? '') !== '')
  .map(([, c]) => c)
console.log(`\nRehabilitación tobillo: ${program.ankleRehab.length} pasos`)
check(rehabSheet.length === program.ankleRehab.length,
  `tobillo: el Excel tiene ${rehabSheet.length}, el import ${program.ankleRehab.length}`)
rehabSheet.forEach((row, index) => {
  const got = program.ankleRehab[index]
  if (!got) return fail(`tobillo: falta el paso ${index + 1}`)
  check(got.name === row.get('B'), `tobillo #${index + 1}: "${got.name}" ≠ "${row.get('B')}"`)
  check(got.stage === row.get('A'), `${got.name}: fase "${got.stage}" ≠ "${row.get('A')}"`)
  check(got.frequency === row.get('E'), `${got.name}: frecuencia no coincide`)
})

// The week, which v3 rearranged.
const EXPECTED_WEEK: Record<string, string> = {
  monday: 'Full Body A', tuesday: 'Cardio + tobillo', wednesday: 'Full Body B',
  thursday: 'Cardio + tobillo', friday: 'Full Body C',
  saturday: 'Tobillo + cardio opcional', sunday: 'Descanso',
}
console.log('\nEstructura semanal')
for (const [weekday, block] of Object.entries(EXPECTED_WEEK)) {
  const got = program.weekStructure.find((d: { weekday: string }) => d.weekday === weekday)
  check(got?.block === block, `${weekday}: "${got?.block}" ≠ "${block}"`)
}

console.log(`\n${failures === 0 ? '✅' : '❌'} ${checks - failures}/${checks} comprobaciones`)
process.exit(failures === 0 ? 0 : 1)
