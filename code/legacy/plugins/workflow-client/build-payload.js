const fs = require('fs')
const path = require('path')

const client = fs.readFileSync(path.join(__dirname, 'client-body.txt'), 'utf8')
const host = "return { inject:['timer','fs'], apply(ctx){ var fs=ctx.get('fs'); async function loadState(root){ if(!fs)return{state:null,error:'fs unavailable'}; try{var r=(root||'').replace(/\\\\\\\\/g,'/').replace(/\\/+$/,'');if(!r)return{state:null,error:'no root'};var p=r+'/.workflow-agent/state.json';var text=await fs.readText(await fs.resolve(p));return{state:JSON.parse(text),error:null}}catch(e){return{state:null,error:e&&e.message?e.message:String(e)}} } harness.handle('wf:status',async function(args){var root=args&&args.workspaceRoot?String(args.workspaceRoot):'';return await loadState(root)}); harness.handle('wf:skill',async function(args){if(!fs)return{error:'fs unavailable'};try{var p=args&&args.path?String(args.path):'';if(!p)return{error:'no path',text:null};return{text:await fs.readText(await fs.resolve(p)),error:null}}catch(e){return{text:null,error:e&&e.message?e.message:String(e)}}}); harness.handle('wf:config',async function(args){var root=args&&args.workspaceRoot?String(args.workspaceRoot):'';if(root&&fs){try{await fs.resolve(root+'/.workflow-agent/state.json');return{valid:true,workspaceRoot:root}}catch(e){return{valid:false,workspaceRoot:root}}}return{valid:false,workspaceRoot:null}}); ctx.effect(function(){return function(){}}) } }"

const payload = {
  plugin: { kind: 'existing', pluginId: 'wfd-14' },
  name: 'WF DAG v8 - fixed typos',
  purpose: 'Fixed c is not defined, RUNNING counts, opacity/stat/cursor, arrow len check',
  code: { host, client },
}

const json = JSON.stringify(payload)
console.log('Payload length:', json.length)
fs.writeFileSync(path.join(__dirname, '_define-payload.json'), json, 'utf8')
console.log('Written to _define-payload.json')