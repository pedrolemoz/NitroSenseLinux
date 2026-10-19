const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function invalid(message) { return Object.assign(new Error(message), { code: 'ERR_NITROSENSE_DESKTOP_ENTRY' }); }
function unescapeValue(value) {
  return value.replace(/\\(.)/g, (_all, char) => {
    const escapes = { s: ' ', n: '\n', t: '\t', r: '\r', '\\': '\\' };
    if (!Object.hasOwn(escapes, char)) throw invalid('Invalid desktop string escape');
    return escapes[char];
  });
}
function parseDesktopEntry(text) {
  if (Buffer.byteLength(text, 'utf8') > 256 * 1024 || text.includes('\0')) throw invalid('Invalid desktop file size/content');
  const fields = Object.create(null); let active = false, found = false;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      active = line === '[Desktop Entry]';
      if (active && found) throw invalid('Repeated Desktop Entry group');
      if (active) found = true;
      continue;
    }
    if (!active) continue;
    const at = line.indexOf('=');
    if (at < 1) throw invalid('Invalid desktop key');
    const key = line.slice(0, at).trim();
    if (!/^[A-Za-z0-9-]+(?:\[[^\]\r\n]+\])?$/.test(key) || Object.hasOwn(fields, key)) throw invalid('Invalid or repeated desktop key');
    fields[key] = line.slice(at + 1).trim();
  }
  if (!found) throw invalid('Desktop Entry group missing');
  return fields;
}
function localized(fields, key, locale) {
  const value = String(locale).replace(/\.[^@]*/, '').replace('-', '_');
  const [base, modifier] = value.split('@'), [language, country] = base.split('_');
  const variants = [country && modifier && `${base}@${modifier}`, country && base,
    modifier && `${language}@${modifier}`, language].filter(Boolean);
  for (const suffix of [...new Set(variants)]) if (Object.hasOwn(fields, `${key}[${suffix}]`)) return unescapeValue(fields[`${key}[${suffix}]`]);
  return fields[key] === undefined ? '' : unescapeValue(fields[key]);
}
function boolean(fields, key) {
  if (!Object.hasOwn(fields, key)) return false;
  if (!['true', 'false'].includes(fields[key])) throw invalid('Invalid desktop boolean');
  return fields[key] === 'true';
}
function list(value = '') {
  const tokens = []; let token = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && value[i + 1] === ';') { token += ';'; i++; }
    else if (value[i] === '\\') { token += value[i] + (value[++i] || ''); }
    else if (value[i] === ';') { if (token) tokens.push(unescapeValue(token)); token = ''; }
    else token += value[i];
  }
  if (token) tokens.push(unescapeValue(token));
  return tokens;
}
function visible(fields, desktops) {
  const only = list(fields.OnlyShowIn), not = list(fields.NotShowIn);
  if (only.some(value => not.includes(value))) throw invalid('Conflicting desktop visibility');
  for (const desktop of desktops) {
    if (only.includes(desktop)) return true;
    if (not.includes(desktop)) return false;
  }
  return !Object.hasOwn(fields, 'OnlyShowIn');
}
// Parse argv[0] for metadata only. Never expand variables/field codes or execute
// Exec; launching, running-process association and scenario switching are separate.
function executableName(raw) {
  const text = unescapeValue(raw).trim();
  let result = '', quoted = false, ended = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (result && !quoted) throw invalid('Invalid executable quoting'); quoted = !quoted; if (!quoted) ended = true; }
    else if (!quoted && /\s/.test(char)) break;
    else if (ended) throw invalid('Invalid executable suffix');
    else if (quoted && char === '\\') {
      const escaped = text[++i]; if (!escaped || !['"', '`', '$', '\\'].includes(escaped)) throw invalid('Invalid executable escape');
      result += escaped;
    } else {
      if (!quoted && /['\\><~|&;$*?#()`]/.test(char)) throw invalid('Unquoted reserved executable character');
      result += char;
    }
  }
  if (quoted || !result || result.includes('=') || /%(?!%)/.test(result.replace(/%%/g, ''))) throw invalid('Invalid executable name');
  return result.replace(/%%/g, '%');
}
function createDesktopCatalog({ env = process.env, home = os.homedir(), locale = 'C',
  dataDirectories, fsImpl = fs, maxFiles = 4096, maxDirectories = 512, maxDepth = 8 } = {}) {
  const roots = dataDirectories || [env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.join(home, '.local/share'),
    ...(env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(value => path.isAbsolute(value))];
  const desktops = (env.XDG_CURRENT_DESKTOP || '').split(':').filter(Boolean);
  const bins = (env.PATH || '').split(path.delimiter).filter(value => path.isAbsolute(value));
  let entries = new Map();
  const executable = name => {
    if (!path.isAbsolute(name) && (name.includes('/') || name.includes('\\'))) return null;
    const candidates = path.isAbsolute(name) ? [name] : bins.map(bin => path.join(bin, name));
    for (const file of candidates) {
      try { if (fsImpl.statSync(file).isFile()) { fsImpl.accessSync(file, fs.constants.X_OK); return file; } }
      catch (error) { if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) throw error; }
    }
    return null;
  };
  function scan() {
    const messagesLocale = typeof locale === 'function' ? locale() : locale;
    const seen = new Set(), apps = [], issues = []; let files = 0, directories = 0;
    const limit = () => { throw Object.assign(new Error('Desktop inventory limit'), { code: 'ERR_NITROSENSE_LIMIT' }); };
    function walk(directory, relative = '', depth = 0) {
      if (++directories > maxDirectories || depth > maxDepth) limit();
      let children;
      try { children = fsImpl.readdirSync(directory, { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(directory, child.name), rel = relative ? `${relative}/${child.name}` : child.name;
        if (child.isDirectory()) { walk(file, rel, depth + 1); continue; }
        if (!child.name.endsWith('.desktop')) continue;
        if (++files > maxFiles) limit();
        const desktopId = rel.replaceAll('/', '-');
        if (seen.has(desktopId)) continue;
        seen.add(desktopId); // Includes Hidden overrides and malformed higher-priority entries.
        try {
          if (!fsImpl.statSync(file).isFile()) continue;
          const fields = parseDesktopEntry(fsImpl.readFileSync(file, 'utf8'));
          if (boolean(fields, 'Hidden') || boolean(fields, 'NoDisplay') || fields.Type !== 'Application' || !visible(fields, desktops)) continue;
          if (!fields.Name) throw invalid('Application Name missing');
          const display = localized(fields, 'Name', messagesLocale);
          if (!display) throw invalid('Application Name empty');
          if (fields.TryExec && !executable(unescapeValue(fields.TryExec))) continue;
          const dbus = boolean(fields, 'DBusActivatable');
          if (!fields.Exec && !dbus) throw invalid('Application Exec missing');
          const binary = fields.Exec && !dbus ? executable(executableName(fields.Exec)) : null;
          if (!dbus && !binary) { issues.push({ desktopId, code: 'EXECUTABLE_UNAVAILABLE' }); continue; }
          apps.push({ id: `linux-desktop:${desktopId}`, desktopId, display, platform: 'linux',
            desktopFile: file, linkTargetParsingPath: file, packageInstallPath: '', isWin32Desktop: false,
            ...(binary ? { executablePath: binary } : {}),
            ...(fields.Icon ? { icon: localized(fields, 'Icon', messagesLocale) } : {}) });
        } catch (error) {
          if (!['ERR_NITROSENSE_DESKTOP_ENTRY', 'ENOENT'].includes(error.code)) throw error;
          issues.push({ desktopId, code: error.code });
        }
      }
    }
    for (const root of [...new Set(roots)]) walk(path.join(root, 'applications'));
    entries = new Map(apps.map(app => [app.id, app]));
    return { apps, issues };
  }
  function lookup(id) {
    if (!entries.has(id)) scan();
    const entry = entries.get(id);
    if (!entry) throw Object.assign(new Error('Unknown desktop application'), { code: 'ERR_NITROSENSE_APP_NOT_FOUND' });
    fsImpl.statSync(entry.desktopFile);
    return { ...entry };
  }
  return { scan, lookup };
}
module.exports = { createDesktopCatalog, parseDesktopEntry, executableName, localized };
