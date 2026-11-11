import { describe, expect, it } from 'vitest';
import { authenticationFor } from './obs';
import { sha256 } from './sha256';

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const bytes = (text: string) => new TextEncoder().encode(text);

describe('sha256', () => {
  it('matches the standard test vectors', () => {
    expect(hex(sha256(bytes('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(hex(sha256(bytes('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hex(sha256(bytes('a'.repeat(1000))))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });
});

describe('authentication', () => {
  it('follows the obs-websocket handshake', () => {
    // Computed independently with Python's hashlib and base64.
    expect(authenticationFor('supersecret', 'thisissomesalt', 'thisissomechallenge')).toBe(
      'CfNrlWedWaqrtNaMlWa3PFmsaeHWoZw5wbKmWrvq0gw=',
    );
  });
});
