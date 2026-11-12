// Stand-ins for firebase-functions v2: each wrapper returns the raw handler, tagged.
export class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
export const onCall = (opts, fn) => Object.assign(fn || opts, { kind: 'call' });
export const onSchedule = (opts, fn) => Object.assign(fn, { kind: 'schedule' });
export const onDocumentUpdated = (opts, fn) => Object.assign(fn, { kind: 'update', document: typeof opts === 'string' ? opts : opts.document });
export const setGlobalOptions = () => {};
export const defineSecret = (name) => ({ value: () => process.env[name] || '' });
