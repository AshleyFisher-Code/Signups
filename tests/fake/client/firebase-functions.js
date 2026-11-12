const user = () => { try { return JSON.parse(localStorage.getItem('fakeUser')); } catch { return null; } };
export const getFunctions = () => ({});
export const connectFunctionsEmulator = () => {};
export function httpsCallable(f, name) {
  return async (data) => {
    const r = await (await fetch('/__fake/call/' + name, { method: 'POST', body: JSON.stringify({ data, user: user() }) })).json();
    if (r.error) { const e = new Error(r.error.message); e.code = 'functions/' + r.error.code; throw e; }
    return { data: r.result };
  };
}
