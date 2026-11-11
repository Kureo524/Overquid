import { describe, expect, it } from 'vitest';
import { roomUrl } from './address';

describe('roomUrl', () => {
  it('reads the forms the room page and the official client use', () => {
    for (const input of [
      'archipelago.gg:38281',
      '  /connect archipelago.gg:38281 ',
      'wss://archipelago.gg:38281',
      'ws://archipelago.gg:38281/',
      'archipelago://Archipelago.GG:38281',
      '38281',
      'archipelago.gg',
    ]) {
      expect(roomUrl(input), input).toEqual({ url: 'wss://archipelago.gg:38281' });
    }
    expect(roomUrl('archipelago.gg:443')).toEqual({ url: 'wss://archipelago.gg:443' });
  });

  it('refuses other hosts, web pages and nonsense', () => {
    expect(roomUrl('localhost:38281')).toEqual({
      error: 'Only rooms hosted on archipelago.gg are supported for now.',
    });
    expect(roomUrl('archipelago.gg.evil.com:1')).toHaveProperty('error');
    expect(roomUrl('https://archipelago.gg/room/abc')).toHaveProperty('error');
    expect(roomUrl('archipelago.gg:1/room')).toHaveProperty('error');
    expect(roomUrl('user:pass@archipelago.gg:1')).toHaveProperty('error');
    expect(roomUrl('archipelago.gg:70000')).toHaveProperty('error');
    expect(roomUrl('archipelago.gg:0')).toHaveProperty('error');
    expect(roomUrl('')).toHaveProperty('error');
  });
});
