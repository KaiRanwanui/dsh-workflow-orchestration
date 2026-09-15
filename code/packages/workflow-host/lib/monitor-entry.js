// @workflow-agent/workflow-host/monitor
// Host 侧空入口：让 composition 的 ui-workflow-monitor 行（浏览器经 dsh.client
// 加载 lib/client.js 的 DAG 面板）在 Host 侧可解析、无害挂载。
// （形态先例：官方 client-ui 包的空入口 main；@linxin666/dsh-web-all 子路径行）
const name = '@workflow-agent/workflow-host/monitor'
function apply() {}
module.exports = { name, apply }
