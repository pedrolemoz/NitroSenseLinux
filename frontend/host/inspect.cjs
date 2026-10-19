// Operator-requested inspection of the original UI. Never selects firmware
// controls or enables optional telemetry. First-run continues only with opt-in unchecked.
const fs = require('node:fs');
const path = require('node:path');
function install(app, stateDir) {
  const output = path.join(stateDir, 'inspection'); fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const report = { backend: 'rust', hardwareWritesEnabled: false, pages: [], rendererErrors: [],
    limitation: 'Navigation/captures only; no hardware acceptance; optional consent never enabled; unmatched states remain untested' };
  let inspecting = false;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  const deadline = setTimeout(() => { report.deadline = true; save(); app.exit(2); }, 60000);
  app.once('will-quit', () => clearTimeout(deadline));
  app.on('browser-window-created', (_event, window) => {
    window.webContents.on('console-message', (_event, level, message, line, source) => {
      if (level >= 3 && report.rendererErrors.length < 100) report.rendererErrors.push({
        category: /reading ['"]([^'"]+)/.exec(message)?.[1] || (/JSON/.test(message) ? 'json' : 'error'),
        codes: [...message.matchAll(/\b(?:ERR_[A-Z_]+|EACCES)\b/g)].map(m => m[0]),
        line, source: typeof source === 'string' ? source.split('?')[0] : null,
      });
    });
    window.webContents.once('dom-ready', async () => {
      if (inspecting) return; inspecting = true;
      try {
        await wait(12000);
        window.setFullScreen(false); window.unmaximize(); window.setContentSize(1168, 934);
        report.firstRun = await window.webContents.executeJavaScript(`(() => {
          const button=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Start Now');
          if(!button)return 'not-present';
          if(document.querySelector('input[type=checkbox]:checked,[role=checkbox][aria-checked=true]'))return 'blocked-existing-opt-in';
          button.click();return 'continued-with-opt-in-unchecked';
        })()`);
        await wait(1200);
        async function closeInformation() {
          return window.webContents.executeJavaScript(`(() => {
            const button=[...document.querySelectorAll('button,[role=button],span,div')].reverse().find(e=>['Next','Got it','Close'].includes(e.textContent.trim())&&e.getBoundingClientRect().width);
            if(!button)return false;button.click();return true;
          })()`);
        }
        for(let i=0;i<12;i++){ if(!await closeInformation())break; await wait(300); }
        report.contentBounds = window.getContentBounds();
        report.scale = require('electron').screen.getDisplayMatching(window.getBounds()).scaleFactor;
        for (const [name, id] of [['Home', 'Home_el'], ['Scenario', 'Scenario_el'], ['PersonalSettings', 'PersonalSettings_el'],
          ['Checkup', 'Checkup_el'], ['Monitoring', 'Monitoring_el'], ['AppCenter', 'AppCenter_el']]) {
          const clicked = await window.webContents.executeJavaScript(`(() => { const e=document.getElementById(${JSON.stringify(id)}); if(!e)return false;e.click();return true;})()`);
          await wait(1500);
          await closeInformation(); await wait(300);
          const state = await window.webContents.executeJavaScript(`({active:document.querySelector('.custom_menu_btn_selected')?.id,text:document.body.innerText})`);
          report.pages.push({ name, clicked, ...state });
          fs.writeFileSync(path.join(output, name + '.png'), (await window.webContents.capturePage()).toPNG(), { mode: 0o600 });
          save();
        }
      } catch (error) { report.inspectionError = { code: error.code || 'UNKNOWN', name: error.name }; }
      finally { save(); clearTimeout(deadline); app.exit(0); }
    });
  });
}
module.exports = { install };
