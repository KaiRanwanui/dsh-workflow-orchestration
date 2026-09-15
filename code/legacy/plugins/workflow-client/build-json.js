const fs = require('fs')
const path = require('path')
const j = JSON.parse(fs.readFileSync(path.join(__dirname, '_payload-v8.json'), 'utf8'))
const out = JSON.stringify({ host: j.code.host, client: j.code.client })
fs.writeFileSync(path.join(__dirname, '_code-obj.json'), out, 'utf8')
try {
  const obj = JSON.parse(out)
  new Function(obj.host); console.log('Host OK')
  new Function(obj.client); console.log('Client OK, length: ' + obj.client.length)
} catch(e) { console.log('ERR: ' + e.message) }
console.log('Output: ' + out.length + ' bytes')
// Also write host and client separately for the tool
fs.writeFileSync(path.join(__dirname, '_host-json.txt'), JSON.stringify(j.code.host), 'utf8')
fs.writeFileSync(path.join(__dirname, '_client-json.txt'), JSON.stringify(j.code.client), 'utf8')
console.log('Written')