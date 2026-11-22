// The viewport media queries, in one place: layout.css uses exactly these
// preludes (a test checks it) and the scripts match against the same strings.

/** Phone landscape: phones on their side are 340–430 px tall; laptops and projectors are taller. */
export const PHONE_LANDSCAPE = '(orientation: landscape) and (max-height: 540px)'

/** Phone portrait: narrower than 600 px. */
export const PHONE_PORTRAIT = '(max-width: 599px)'

/** Any phone, portrait or landscape. */
export const PHONE = `${PHONE_PORTRAIT}, ${PHONE_LANDSCAPE}`

/** Below the wide layout or in phone landscape: the header is hidden and a tapped recorder expands. */
export const COMPACT = `(width <= 960px), ${PHONE_LANDSCAPE}`

/** The wide layout: the flight beside a card column. */
export const WIDE = '(width > 960px)'

/** Every query layout.css may use. */
export const MEDIA_QUERIES: readonly string[] = [PHONE_LANDSCAPE, PHONE_PORTRAIT, PHONE, COMPACT, WIDE]
