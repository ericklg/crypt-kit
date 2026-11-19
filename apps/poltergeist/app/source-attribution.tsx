import type { PriceSource } from '../sources/price-source';

/**
 * The logo a source's terms require wherever its data appears (Best Buy's Branding
 * Guidelines), as the source provides it: their image and link, unaltered, kept smaller
 * than the app's own name. Renders nothing for sources without one.
 */
export function SourceAttribution({ attribution }: { attribution: PriceSource['attribution'] | undefined }) {
  if (!attribution) return null;
  return (
    <a className="pg-attribution" href={attribution.href} target="_blank" rel="noopener noreferrer">
      <img src={attribution.logo} alt={attribution.alt} />
    </a>
  );
}
