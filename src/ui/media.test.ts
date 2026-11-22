import { describe, expect, it } from 'vitest'
import { COMPACT, MEDIA_QUERIES, PHONE, PHONE_LANDSCAPE, PHONE_PORTRAIT, WIDE } from './media.ts'

describe('media queries', () => {
  it('pins each query string', () => {
    expect(PHONE_LANDSCAPE).toBe('(orientation: landscape) and (max-height: 540px)')
    expect(PHONE_PORTRAIT).toBe('(max-width: 599px)')
    expect(PHONE).toBe('(max-width: 599px), (orientation: landscape) and (max-height: 540px)')
    expect(COMPACT).toBe('(width <= 960px), (orientation: landscape) and (max-height: 540px)')
    expect(WIDE).toBe('(width > 960px)')
  })

  it('lists every query once', () => {
    expect([...MEDIA_QUERIES].sort()).toEqual([COMPACT, PHONE, PHONE_LANDSCAPE, PHONE_PORTRAIT, WIDE].sort())
    expect(new Set(MEDIA_QUERIES).size).toBe(MEDIA_QUERIES.length)
  })
})
