// Node module hooks: when the functions import firebase-admin / firebase-functions, hand them fakes.
const here = new URL('./', import.meta.url).href;
const map = {
  'firebase-admin/app': here + 'admin-app.mjs',
  'firebase-admin/firestore': here + 'admin-firestore.mjs',
  'firebase-functions/v2/https': here + 'functions.mjs',
  'firebase-functions/v2/scheduler': here + 'functions.mjs',
  'firebase-functions/v2/firestore': here + 'functions.mjs',
  'firebase-functions/v2': here + 'functions.mjs',
  'firebase-functions/params': here + 'functions.mjs',
};
export async function resolve(spec, ctx, next) {
  if (map[spec]) return { url: map[spec], shortCircuit: true };
  return next(spec, ctx);
}
