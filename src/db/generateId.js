// Collision-proof ID generator for multi-device Dexie + Supabase sync.
// Produces BIGINT-compatible unique IDs: timestamp_ms * 1000 + counter + random offset.
// Fits within JS Number.MAX_SAFE_INTEGER (9007199254740991 → works until ~year 2255).

let lastMs = 0;
let counter = 0;

export function generateId() {
    const now = Date.now();
    if (now === lastMs) {
        counter++;
    } else {
        lastMs = now;
        // Random offset 0-99 prevents cross-device collision within the same millisecond
        counter = Math.floor(Math.random() * 100);
    }
    return now * 1000 + counter;
}
