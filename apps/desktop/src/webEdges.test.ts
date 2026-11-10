import { describe, expect, it } from 'vitest';
import { edgeGradient, sameEdges, type PageEdges } from './webEdges';

describe('edgeGradient', () => {
  it('spreads the colours along the page, past the overhang', () => {
    expect(edgeGradient('to right', ['#111111', '#222222', '#333333'], 16)).toBe(
      'linear-gradient(to right, #111111 calc(16px + (100% - 32px) * 0), ' +
        '#222222 calc(16px + (100% - 32px) * 0.5), #333333 calc(16px + (100% - 32px) * 1))',
    );
  });
});

describe('sameEdges', () => {
  const edges: PageEdges = {
    panelId: 'p',
    top: ['#000000'],
    right: ['#111111'],
    bottom: ['#222222'],
    left: ['#333333'],
  };

  it('tells whether any edge changed', () => {
    expect(sameEdges(edges, { ...edges })).toBe(true);
    expect(sameEdges(edges, { ...edges, left: ['#444444'] })).toBe(false);
  });
});
