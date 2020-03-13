const compiler = require('circom')
const fs = require('fs')
const path = require('path')

const zkSnark = require('snarkjs')
const childProcess = require('child_process')
const libsemaphore = require('libsemaphore')

const identity = libsemaphore.genIdentity()
const idc = libsemaphore.genIdentityCommitment(identity)
const externalNullifier = '0'

const runTrustedSetup = async (
  circuit,
  provingKeyJSONPath,
  verificationKeyJSONPath,
  provingKeyBinPath
) => {
  console.log('run trusted setup')
  console.time('setup')
  const setup = zkSnark.groth.setup(circuit)
  console.timeEnd('setup')
  fs.writeFileSync(
    provingKeyJSONPath,
    JSON.stringify(zkSnark.stringifyBigInts(setup.vk_proof))
  )
  fs.writeFileSync(
    verificationKeyJSONPath,
    JSON.stringify(zkSnark.stringifyBigInts(setup.vk_verifier))
  )
  const cp = childProcess.spawnSync('node', [
    'node_modules/websnark/tools/buildpkey.js',
    '-i',
    provingKeyJSONPath,
    '-o',
    provingKeyBinPath
  ])
  console.log(cp.stdout.toString())
  console.log(cp.stderr.toString())
}

const runExperiment = async treeDepth => {
  const experiment = `treeDepth_${treeDepth}`

  console.log('Running experiment', experiment)

  const experimentDir = path.join(__dirname, 'experiments', experiment)
  console.log('experimentDir:', experimentDir)
  fs.mkdirSync(experimentDir, { recursive: true })

  const semaphoreCircom = `
  include "./semaphore-base.circom";

  component main = Semaphore(${treeDepth});
  `

  const p = path.join(__dirname, 'circom', 'semaphore.circom')
  fs.writeFileSync(p, semaphoreCircom)

  const circuitPath = path.join(experimentDir, 'circuit.json')

  if (!fs.existsSync(circuitPath)) {
    console.log('circuit inexistent, compiling')
    console.time('CompilingCircuit')
    await compiler(p).then(cir =>
      fs.writeFileSync(circuitPath, JSON.stringify(cir, null, 1), 'utf8')
    )
    console.timeEnd('CompilingCircuit')
  } else {
    console.log('circuit exists, skip compiling')
  }

  const circuitDef = JSON.parse(fs.readFileSync(circuitPath, 'utf8'))
  const circuit = new zkSnark.Circuit(circuitDef)

  const provingKeyJSONPath = path.join(experimentDir, './proving_key.json')
  const verificationKeyJSONPath = path.join(
    experimentDir,
    './verification_key.json'
  )
  const provingKeyBinPath = path.join(experimentDir, './proving_key.bin')

  if (!fs.existsSync(provingKeyJSONPath)) {
    await runTrustedSetup(
      circuit,
      provingKeyJSONPath,
      verificationKeyJSONPath,
      provingKeyBinPath
    )
  } else {
    console.log('Proving key exists, skip setup')
  }

  const provingKey = fs.readFileSync(provingKeyBinPath)
  const verificationKey = libsemaphore.parseVerifyingKeyJson(
    fs.readFileSync(verificationKeyJSONPath).toString()
  )

  const provingStart = process.hrtime.bigint()

  const { witness } = await libsemaphore.genWitness(
    'signal0',
    circuit,
    identity,
    [idc],
    treeDepth,
    externalNullifier
  )
  console.log('Proving')
  const proof = await libsemaphore.genProof(witness, provingKey)
  const publicSignals = libsemaphore.genPublicSignals(witness, circuit)
  const provingTime = process.hrtime.bigint() - provingStart

  console.log('Verifying')
  const verificationStart = process.hrtime.bigint()
  zkSnark.groth.isValid(verificationKey, proof, publicSignals)
  const verificationTime = process.hrtime.bigint() - verificationStart

  const report = {
    treeDepth,
    circuitSize: fs.statSync(circuitPath).size,
    provingKeySize: fs.statSync(provingKeyBinPath).size,
    verificationKeySize: fs.statSync(verificationKeyJSONPath).size,
    provingTime: provingTime.toString(),
    verificationTime: verificationTime.toString()
  }
  console.log(report)
  const reportPath = path.join(experimentDir, 'report.json')
  fs.writeFileSync(reportPath, JSON.stringify(report))
}

const main = async () => {
  const treeDepths = [4, 8, 12, 16, 20]
  for (let td of treeDepths) {
    await runExperiment(td)
  }
}
main()
