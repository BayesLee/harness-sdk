import assert, { AssertionError } from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const options = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]
  const value = process.argv[index + 1]
  assert.ok(['--source', '--output', '--mode'].includes(key) && value, 'Invalid arguments')
  assert.ok(!options.has(key), `Duplicate option: ${key}`)
  options.set(key, value)
}
const source = options.get('--source')
const output = options.get('--output')
const mode = options.get('--mode')
assert.ok(source && output, 'Pass --source SDK_SOURCE and --output RESULTS_DIRECTORY')
assert.ok(mode === 'baseline' || mode === 'contract', 'Pass --mode baseline or contract')

async function sdkModule(relativePath: string) {
  return import(pathToFileURL(resolve(source!, 'strands-ts/src', relativePath)).href)
}

const { createRetrievalTool, RETRIEVAL_TOOL_NAME } = await sdkModule('context-manager/retrieval-tool.ts')
const { Stash } = await sdkModule('context-manager/stash.ts')
const { InMemoryStorage } = await sdkModule('storage/in-memory-storage.ts')
const { createMockContext } = await sdkModule('__fixtures__/tool-helpers.ts')
const { collectGenerator } = await sdkModule('__fixtures__/model-test-helpers.ts')
const { TextBlock, ToolResultBlock } = await sdkModule('types/messages.ts')

const baselineCommit = '79cd7356d3947e2f1bdfa65529938f80aad03b87'
const stash = new Stash(new InMemoryStorage(), 'issue-4241', 'independent-repro')
const text = 'hello world\nline two'
const encodeJSON = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const textReference = await stash.store('tool-text', 0, encodeJSON({ text }))
const imageReference = await stash.store(
  'tool-img',
  0,
  encodeJSON({ image: { format: 'png', source: { bytes: 'iVBORw0KGgo=' } } })
)
const retrievalTool = createRetrievalTool(stash)
assert.ok(typeof retrievalTool.invoke === 'function')
const missingText = 'Error: reference not found: nonexistent'
const nonText = 'Error: cannot search non-text content. Omit pattern/line_range to retrieve full content.'
const noMatchText = "No matches found for pattern 'NOT_PRESENT_4241' (searched 2 lines)."
const scenarios = [
  { id: 'missing-reference', input: { reference: 'nonexistent' }, expectedRaw: missingText,
    expectedText: missingText, expectedStatus: 'error' },
  { id: 'non-text-pattern', input: { reference: imageReference, pattern: 'test' }, expectedRaw: nonText,
    expectedText: nonText, expectedStatus: 'error' },
  { id: 'full-text', input: { reference: textReference }, expectedRaw: { text },
    expectedText: text, expectedStatus: 'success' },
  { id: 'no-match', input: { reference: textReference, pattern: 'NOT_PRESENT_4241' }, expectedRaw: noMatchText,
    expectedText: noMatchText, expectedStatus: 'success' },
]

const observations = []
for (const scenario of scenarios) {
  let rawInvokeResult: unknown
  let invokeError: string | null = null
  try {
    rawInvokeResult = await retrievalTool.invoke(scenario.input)
  } catch (error: unknown) {
    invokeError = error instanceof Error ? error.message : String(error)
  }
  const context = createMockContext({
    name: RETRIEVAL_TOOL_NAME, toolUseId: scenario.id, input: scenario.input,
  })
  const { items, result } = await collectGenerator(retrievalTool.stream(context))
  assert.deepStrictEqual(items, [])
  assert.ok(result instanceof ToolResultBlock)
  if (mode === 'baseline') {
    assert.equal(invokeError, null)
    assert.deepStrictEqual(rawInvokeResult, scenario.expectedRaw)
    assert.deepStrictEqual(result, new ToolResultBlock({
      toolUseId: scenario.id, status: 'success', content: [new TextBlock(scenario.expectedText)],
    }))
  }
  const expectedResult = new ToolResultBlock({
    toolUseId: scenario.id, status: scenario.expectedStatus, content: [new TextBlock(scenario.expectedText)],
  }).toJSON()
  let contractPassed = true
  try {
    assert.deepStrictEqual(result.toJSON(), expectedResult)
  } catch (error: unknown) {
    if (!(error instanceof AssertionError)) throw error
    contractPassed = false
  }
  observations.push({
    id: scenario.id, input: scenario.input,
    rawInvokeResult: rawInvokeResult === undefined ? null : rawInvokeResult, invokeError,
    yieldedEvents: items, streamResult: result.toJSON(), expectedResult, contractPassed,
  })
  console.log(`${scenario.id}: actual=${result.status}; expected=${scenario.expectedStatus}; contract=${contractPassed ? 'PASS' : 'FAIL'}`)
}
const failedContractCases = observations.filter((item) => !item.contractPassed).map((item) => item.id)
if (mode === 'baseline') {
  assert.deepStrictEqual(failedContractCases, ['missing-reference', 'non-text-pattern'])
}
mkdirSync(output, { recursive: true })
writeFileSync(resolve(output, `${mode}-results.json`), JSON.stringify({
  issue: 'https://github.com/strands-agents/harness-sdk/issues/4241',
  baselineCommit,
  testedSource: mode === 'baseline' ? 'Selected files match the pinned baseline fingerprints' : 'User-supplied source; baseline fingerprints are not enforced',
  timestamp: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  scope: 'Real retrieval tool stream wrapper, Stash and InMemoryStorage; upstream mock context; no Agent/model invocation',
  mode, observations, failedContractCases,
}, null, 2) + '\n')
console.log(mode === 'baseline' ? 'BASELINE_REPRODUCED' : failedContractCases.length ? 'CONTRACT_FAILED' : 'CONTRACT_PASSED')
if (mode === 'contract' && failedContractCases.length) process.exitCode = 1
