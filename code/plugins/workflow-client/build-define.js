// Build and submit the flicker-fix plugin via cordis_define
// Reads host and client code from text files

const fs = require('fs')
const path = require('path')

const HOST = fs.readFileSync(path.join(__dirname, 'host-body.txt'), 'utf8').trim()
const CLIENT = fs.readFileSync(path.join(__dirname, 'client-flicker-fix.txt'), 'utf8').trim()

// console.log('HOST:', HOST.substring(0, 100) + '...')
// console.log('CLIENT:', CLIENT.substring(0, 100) + '...')
console.log('HOST lines:', HOST.split('\n').length)
console.log('CLIENT lines:', CLIENT.split('\n').length)

// Write the JSON payload for reference
const payload = {
  plugin: { idPrefix: 'wff', kind: 'new' },
  name: 'Dashboard flicker fix v2',
  purpose: 'Fix flicker: module-level state survives remount',
  code: {
    host: HOST,
    client: CLIENT,
  },
}

const outPath = path.join(__dirname, 'cordis-define-payload.json')
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8')
console.log('Wrote payload to', outPath)