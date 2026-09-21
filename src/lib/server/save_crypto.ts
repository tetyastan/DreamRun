/**
 * Symmetric encryption for .dreamsave payloads.
 *
 * The blob layout is:
 *
 *     [ 8 bytes magic ][ 12 bytes IV ][ AES-GCM ciphertext ]
 *
 * The magic identifies the container version so that a future format
 * change can be detected without ambiguity. The IV is regenerated on
 * every encrypt; only the ciphertext depends on the key.
 *
 * The key is derived from a static project secret via SHA-256. This
 * is deliberately not a user key: the goal is tamper resistance
 * against casual inspection of a local save file, not confidentiality
 * against an adversary with the source.
 */

// "DRMSAVE1" — container magic, version 1.
const MAGIC = new Uint8Array([0x44, 0x52, 0x4D, 0x53, 0x41, 0x56, 0x45, 0x31]);

// AES-GCM standard IV length in bytes.
const IV_LENGTH = 12;

// The imported CryptoKey is expensive to derive; cache it across
// calls so that repeated save/load cycles do not re-hash the secret.
let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
    if (cachedKey) return cachedKey;
    const secret = 'DreamRun-Template-Static-Save-Key-v1';
    const raw = new TextEncoder().encode(secret);
    const hash = await crypto.subtle.digest('SHA-256', raw);
    cachedKey = await crypto.subtle.importKey(
        'raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']
    );
    return cachedKey;
}

/**
 * Encrypts a plaintext payload and returns a self-describing blob
 * ready to be base64-encoded and embedded in a SaveFile.
 */
export async function encryptSave(plaintext: Uint8Array): Promise<Uint8Array> {
    const key = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const cipher = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, key, plaintext
    ));

    const out = new Uint8Array(MAGIC.length + IV_LENGTH + cipher.length);
    out.set(MAGIC, 0);
    out.set(iv, MAGIC.length);
    out.set(cipher, MAGIC.length + IV_LENGTH);
    return out;
}

/**
 * Inverse of encryptSave. Throws if the blob is too short, if the
 * magic does not match, or if AES-GCM authentication fails (which
 * indicates tampering or a key change).
 */
export async function decryptSave(blob: Uint8Array): Promise<Uint8Array> {
    if (blob.length < MAGIC.length + IV_LENGTH) {
        throw new Error('SAVE_BLOB_TOO_SHORT');
    }
    for (let i = 0; i < MAGIC.length; i++) {
        if (blob[i] !== MAGIC[i]) throw new Error('SAVE_MAGIC_MISMATCH');
    }

    const iv = blob.subarray(MAGIC.length, MAGIC.length + IV_LENGTH);
    const cipher = blob.subarray(MAGIC.length + IV_LENGTH);
    const key = await getKey();
    const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv }, key, cipher
    );
    return new Uint8Array(plain);
}