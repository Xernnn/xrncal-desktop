import React from 'react'
import markUrl from '../../assets/mark.svg'

/**
 * The xrn family tile, shown where the app would otherwise write its own name:
 * every xrn app is known by its tile rather than a wordmark. The name stays as
 * the image's text, for screen readers. `scripts/build-icons.sh` writes the SVG
 * from resources/icon.svg, and tests/logo.test.ts keeps the two the same.
 */
export const AppMark: React.FC<{ size: number; className?: string }> = ({ size, className }) => (
  <img
    src={markUrl}
    alt="xrncal"
    width={size}
    height={size}
    draggable={false}
    className={`shrink-0 select-none ${className ?? ''}`}
  />
)
