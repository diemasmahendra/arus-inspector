const { randomUUID } = require('node:crypto');
const MAX_BODY = 1024 * 1024;
const MAX_RECORDS = 3000;
const MAX_MEMORY = 48 * 1024 * 1024;
function validUrl(input) {
  if (typeof input !== 'string' || input.length > 8192) throw new Error('URL terlalu panjang.');
  const u = new URL(input.includes('://') ? input : `https://${input}`);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Gunakan URL HTTP atau HTTPS tanpa kredensial.');
  return u.href;
}
function isText(mime = '') { return /json|text|javascript|xml|svg|x-www-form-urlencoded/.test(mime); }
function clip(value = '') { return String(value).slice(0, MAX_BODY); }
const secretHeader = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token)$/i;
const secretKey = /token|password|secret|api.?key|authorization|session|credential|otp/i;
function redactUrl(url) { const u = new URL(url); for (const key of u.searchParams.keys()) if (secretKey.test(key)) u.searchParams.set(key, '[REDACTED]'); u.hash = ''; return u.href; }
function redactHeaders(headers) { return Object.fromEntries(Object.entries(headers || {}).map(([k,v]) => [k, secretHeader.test(k) ? '[REDACTED]' : v])); }
function curl(row, sensitive = false) {
  const quote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const headers = sensitive ? row.requestHeaders : redactHeaders(row.requestHeaders);
  let out = `curl ${quote(sensitive ? row.url : redactUrl(row.url))} -X ${quote(row.method)}`;
  for (const [key, value] of Object.entries(headers || {})) if (!/^(host|content-length|connection|accept-encoding|:)/i.test(key)) out += ` \\\n  -H ${quote(`${key}: ${value}`)}`;
  if (row.requestBody && sensitive) out += ` \\\n  --data-raw ${quote(row.requestBody)}`;
  return out;
}
class CaptureStore {
  constructor(notify = () => {}) { this.notify = notify; this.clear(); }
  clear() { this.rows = new Map(); this.ids = new Map(); this.bytes = 0; this.generation = (this.generation || 0) + 1; this.notify('clear'); }
  trim() {
    while (this.rows.size > MAX_RECORDS || this.bytes > MAX_MEMORY) {
      const id = this.rows.keys().next().value; const row = this.rows.get(id);
      this.bytes -= row._bytes || 0; this.rows.delete(id);
      for (const [key, value] of this.ids) if (value === id) this.ids.delete(key);
      this.notify('remove', id);
    }
  }
  add(data, key) {
    const row = { id: randomUUID(), startedAt: new Date().toISOString(), status: null, duration: null, size: 0, requestHeaders: {}, responseHeaders: {}, requestBody: '', responseBody: '', ...data };
    this.rows.set(row.id, row); if (key) this.ids.set(key, row.id);
    this.update(row.id, {}); this.trim(); return row;
  }
  update(id, patch) {
    const row = this.rows.get(id); if (!row) return;
    this.bytes -= row._bytes || 0;
    Object.assign(row, patch);
    row.requestBody = clip(row.requestBody); row.responseBody = clip(row.responseBody);
    row._bytes = Buffer.byteLength(JSON.stringify({...row, _bytes: 0})); this.bytes += row._bytes;
    this.notify('upsert', this.summary(row)); this.trim(); return row;
  }
  summary(row) { const { requestBody, responseBody, requestHeaders, responseHeaders, _bytes, ...rest } = row; return rest; }
  list() { return [...this.rows.values()].map(r => this.summary(r)); }
  get(id) { const row = this.rows.get(id); if (!row) return null; const {_bytes, ...data} = row; return data; }
  har(sensitive = false) {
    return {log: {version: '1.2', creator: {name: 'Arus', version: '0.1.0'}, entries: [...this.rows.values()].map(r => ({
      startedDateTime: r.startedAt, time: r.duration || 0,
      request: {method: r.method, url: sensitive ? r.url : redactUrl(r.url), httpVersion: 'HTTP/1.1',
        headers: Object.entries(sensitive ? r.requestHeaders : redactHeaders(r.requestHeaders)).map(([name,value])=>({name,value:String(value)})),
        queryString: [...new URL(sensitive ? r.url : redactUrl(r.url)).searchParams].map(([name,value])=>({name,value})), cookies: [], headersSize: -1, bodySize: -1,
        ...(r.requestBody && sensitive ? {postData:{mimeType:r.requestHeaders['Content-Type'] || 'text/plain', text:r.requestBody}} : {})},
      response: {status:r.status || 0, statusText:r.statusText || '', httpVersion:r.protocol || 'HTTP/1.1',
        headers:Object.entries(sensitive ? r.responseHeaders : redactHeaders(r.responseHeaders)).map(([name,value])=>({name,value:String(value)})), cookies: [],
        content:{size:r.size || 0, mimeType:r.mime || '', ...(sensitive ? {text:r.responseBody || ''} : {})}, redirectURL:'', headersSize:-1, bodySize:r.size || 0},
      cache: {}, timings:{send:0, wait:r.duration || 0, receive:0},
      _arus: {bodyOmitted:!sensitive, error:r.error, bodyNote:r.bodyNote}
    }))}};
  }
}
module.exports = {CaptureStore, validUrl, isText, clip, curl, redactHeaders, redactUrl, MAX_BODY};
