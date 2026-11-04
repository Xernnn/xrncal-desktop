import React from 'react'
import { TODAY_COLOR } from '@shared/mini-calendar-grid'
import { useNow } from '../hooks/use-now'

/**
 * The red current-time line across today's column. It reads the clock itself,
 * once a minute, so only this line re-renders as time passes - not the grid.
 */
export const NowLine: React.FC<{ hourHeight: number; dotClassName: string }> = ({ hourHeight, dotClassName }) => {
  const now = useNow()
  return (
    <div
      className="pointer-events-none absolute right-0 left-0 z-20 flex items-center"
      style={{ top: `${((now.hour * 60 + now.minute) / 60) * hourHeight}px` }}
    >
      <div className={`shrink-0 rounded-full ${dotClassName}`} style={{ backgroundColor: TODAY_COLOR }} />
      <div className="h-0.5 flex-1" style={{ backgroundColor: TODAY_COLOR }} />
    </div>
  )
}

export default NowLine
