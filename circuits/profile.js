const compiler = require('circom')
const fs = require('fs')
const path = require('path')

const zkSnark = require('snarkjs')
const childProcess = require('child_process')

const main = async () => {
  const experiment = 'exp1'

  const experimentDir = path.join(__dirname, 'experiments', experiment)
  fs.mkdirSync(experimentDir, { recursive: true })

  const assignSignal = `
  template A() {
    signal output out;
  
    out = 3;  // This is an error that compile should detect
  }
  
  component main = A();
  `

  const p = path.join(experimentDir, 'assignSginal.circom')
  fs.writeFileSync(p, assignSignal)

  const circuitPath = path.join(experimentDir, 'circuit.json')

  if (!fs.existsSync(circuitPath)) {
    await compiler(p).then(cir =>
      fs.writeFileSync(circuitPath, JSON.stringify(cir, null, 1), 'utf8')
    )
  }

  console.log('circuit size', fs.statSync(circuitPath).size)

  const circuitDef = JSON.parse(fs.readFileSync(circuitPath, 'utf8'))
  const circuit = new zkSnark.Circuit(circuitDef)

  const setup = zkSnark.groth.setup(circuit)

  const provingKeyJSONPath = path.join(experimentDir, './proving_key.json')
  const verificationKeyJSONPath = path.join(
    experimentDir,
    './verification_key.json'
  )
  const provingKeyBinPath = path.join(experimentDir, './proving_key.bin')
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

  const input = {}
  const witness = circuit.calculateWitness(input)

  const { proof, publicSignals } = zkSnark.groth.genProof(
    setup.vk_proof,
    witness
  )
  console.log(publicSignals)
  const isValid = zkSnark.groth.isValid(setup.vk_verifier, proof, publicSignals)
  console.log(isValid)
}
main()
