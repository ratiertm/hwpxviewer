import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SelectionOverlay } from './SelectionOverlay';

describe('SelectionOverlay', () => {
  it('renders nothing when there are no rects', () => {
    const { container } = render(
      <SelectionOverlay rects={[]} page={0} viewBox="0 0 100 100" />,
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders nothing when viewBox is null (no alignment possible)', () => {
    const { container } = render(
      <SelectionOverlay
        rects={[{ page: 0, x: 1, y: 2, width: 3, height: 4 }]}
        page={0}
        viewBox={null}
      />,
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders one rect per entry on the current page', () => {
    const { container } = render(
      <SelectionOverlay
        rects={[
          { page: 0, x: 10, y: 20, width: 30, height: 40 },
          { page: 0, x: 50, y: 60, width: 70, height: 80 },
        ]}
        page={0}
        viewBox="0 0 500 800"
      />,
    );
    const rects = container.querySelectorAll('rect');
    expect(rects).toHaveLength(2);
    expect(rects[0]?.getAttribute('x')).toBe('10');
    expect(rects[1]?.getAttribute('width')).toBe('70');
  });

  it('skips rects from other pages', () => {
    const { container } = render(
      <SelectionOverlay
        rects={[
          { page: 0, x: 1, y: 2, width: 3, height: 4 },
          { page: 1, x: 5, y: 6, width: 7, height: 8 },
        ]}
        page={0}
        viewBox="0 0 10 10"
      />,
    );
    expect(container.querySelectorAll('rect')).toHaveLength(1);
  });

  it('applies the passed viewBox to the overlay svg', () => {
    const { container } = render(
      <SelectionOverlay
        rects={[{ page: 0, x: 0, y: 0, width: 1, height: 1 }]}
        page={0}
        viewBox="0 0 595 842"
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 595 842');
  });
});
