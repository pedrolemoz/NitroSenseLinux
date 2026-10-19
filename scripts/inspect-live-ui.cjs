// Diagnostic entrypoint: normal Linux read-only bootstrap, real providers.
// No fixture, simulator, hardware-control backend or privileged process.
const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const project = path.resolve(__dirname, '..');
const output = path.join(project, '.state', 'linux-live-inspection-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(output, { recursive: true });
const report = { realReadOnlyBootstrap: true, pages: [], rendererErrors: [] };
function finish(code) { fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(output); electron.app.exit(code); }
process.on('uncaughtException', error => { report.mainError = { code: error.code || 'UNKNOWN', stack: String(error.stack).slice(0,2000) }; finish(1); });
process.on('unhandledRejection', error => { report.mainRejection = { code: error?.code || 'UNKNOWN' }; });
electron.dialog.showErrorBox = () => { report.nativeErrorBox = true; finish(1); };
electron.dialog.showMessageBoxSync = () => 1;
electron.dialog.showMessageBox = async () => ({ response: 1 });
electron.BrowserWindow.prototype.show = function() {};
electron.BrowserWindow.prototype.showInactive = function() {};
electron.BrowserWindow.prototype.focus = function() {};
electron.Notification.prototype.show = function() {};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
electron.app.on('browser-window-created', (_e, window) => {
 window.webContents.on('console-message', (_event, level, message) => { if(level>=3 && report.rendererErrors.length<40) report.rendererErrors.push({category:/reading ['"]([^'"]+)/.exec(message)?.[1]||'error', codes:[...message.matchAll(/\b(?:ERR_[A-Z_]+|EACCES)\b/g)].map(m=>m[0])}); });
 window.webContents.once('dom-ready', async () => {
  try {
   await wait(10000);
   async function clickText(text) {
    return window.webContents.executeJavaScript(`(() => { const e=[...document.querySelectorAll('button,[role=button],span,div')].reverse().find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width);if(e){e.click();return true}return false})()`);
   }
   await window.webContents.executeJavaScript(`document.querySelectorAll('input[type=checkbox]').forEach(e=>{if(e.checked)e.click()})`);
   await clickText('Start Now');
   await wait(1500);
   for(let i=0;i<8;i++){let action=false;for(const t of ['Next','Got it','Close'])if(await clickText(t)){action=true;break}if(!action)break;await wait(300)}
   for (const [name,id] of [['Home','Home_el'],['Monitoring','Monitoring_el'],['AppCenter','AppCenter_el'],['Checkup','Checkup_el']]) {
    // Diagnostic clicks bypass first-run overlays; screenshots preserve them.
    await window.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(id)})?.click()`);
    await wait(1300);
    await clickText('Close');
    await wait(400);
    const state = await window.webContents.executeJavaScript(`({url:location.href,text:document.body.innerText,active:document.querySelector('.custom_menu_btn_selected')?.id})`);
    report.pages.push({name,...state});
    fs.writeFileSync(path.join(output,name+'.png'),(await window.webContents.capturePage()).toPNG());
   }
   finish(0);
  }catch(error){report.inspectionError=String(error.stack);finish(1);}
 });
});
setTimeout(()=>{report.deadline=true;finish(2)},35000);
process.env.NITROSENSE_STATE_DIR = path.join(output,'app-state');
process.argv.push('--read-only','--vendor',path.join(project,'vendor/nitrosense-5.2.84-official'));
require('../runtime/bootstrap.cjs');
