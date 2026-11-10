/**
 * CalDAV Discovery, URL Normalization, and XML Multistatus Parser
 */

type CalDavProvider = 'nextcloud' | 'icloud' | 'synology' | 'generic'

export interface CalDavCalendarDescriptor {
  href: string
  displayName: string
  color?: string
  ctag?: string
  syncToken?: string
  isReadOnly?: boolean
}

/**
 * Normalize CalDAV server base URL based on provider preset
 */
export function normalizeCalDavUrl(
  provider: CalDavProvider,
  rawUrl?: string,
  username?: string
): string {
  if (provider === 'icloud') {
    return 'https://caldav.icloud.com'
  }

  let url = (rawUrl || '').trim()
  if (!url) {
    if (provider === 'nextcloud') return 'https://cloud.example.com/remote.php/dav'
    if (provider === 'synology') return 'https://synology.local:5001/caldav'
    return 'https://caldav.example.com'
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`
  }

  // Remove trailing slashes
  url = url.replace(/\/+$/, '')

  if (provider === 'nextcloud') {
    if (!url.includes('/remote.php/dav') && !url.includes('/remote.php/caldav')) {
      url = `${url}/remote.php/dav`
    }
  } else if (provider === 'synology' && username) {
    if (!url.includes(`/caldav/${username}`) && !url.includes('/caldav')) {
      url = `${url}/caldav/${encodeURIComponent(username)}`
    }
  }

  return url
}

/**
 * What to call a CalDAV account the user did not name: the server it lives on
 * (`homeserver.example.ts.net`, `cloud.example.com`), which is what tells two
 * accounts apart in the list - the old `GENERIC (sonn)` said neither.
 */
export function defaultCalDavName(provider: CalDavProvider, normalizedUrl: string): string {
  if (provider === 'icloud') return 'iCloud'
  try {
    return new URL(normalizedUrl).hostname
  } catch {
    return 'CalDAV'
  }
}

/**
 * Simple XML tag value extractor from XML multistatus response
 */
export function extractXmlTagValue(xml: string, tagName: string): string | undefined {
  // Support namespaced tags e.g. <D:displayname> or <displayname>
  const regex = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tagName}>`, 'i')
  const match = xml.match(regex)
  return match ? match[1].trim() : undefined
}

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }

/**
 * The text of an element, with XML's escaping undone; extractXmlTagValue()
 * returns the raw markup, which is what nested elements need. Servers escape
 * `&`, `<` and `>` in text - calendar-data above all, where an event titled
 * "R&D" arrived as "R&amp;D" and went back to the server that way on the next
 * edit. One pass, so "&amp;lt;" stays "&lt;". A CDATA section is returned as is.
 */
export function extractXmlText(xml: string, tagName: string): string | undefined {
  const raw = extractXmlTagValue(xml, tagName)
  if (raw === undefined) return undefined
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/)
  if (cdata) return cdata[1]
  return raw.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(lt|gt|quot|apos|amp));/g, (_, dec, hex, name) => {
    if (name) return XML_ENTITIES[name]
    // A reference past Unicode (&#99999999;) made fromCodePoint throw, and one
    // such character from a server stopped calendar discovery.
    const code = dec ? Number(dec) : parseInt(hex, 16)
    return code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD'
  })
}

/**
 * A calendar colour as the server gives it (`#039BE5`, Apple's `#7C9CBFFF`
 * with alpha, `#abc`) as `#rrggbb`; anything else is dropped. The value ends up
 * in style attributes, so a server does not get to put arbitrary text there.
 */
export function normalizeCalendarColor(value: string | undefined): string | undefined {
  const hex = value?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1]
  if (!hex) return undefined
  const rgb = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex.slice(0, 6)
  return `#${rgb.toLowerCase()}`
}

/**
 * The href a DAV property points at, e.g. the `/sonn/` in
 * `<current-user-principal><href>/sonn/</href></current-user-principal>`.
 */
export function extractPropHref(xml: string, propName: string): string | undefined {
  const inner = extractXmlTagValue(xml, propName)
  return inner ? extractXmlText(inner, 'href') : undefined
}

/** An href from a multistatus, made absolute against the URL that answered. */
export function resolveDavHref(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return href
  }
}

/**
 * Parse CalDAV PROPFIND Multistatus XML into calendar descriptors
 */
export function parseCalDavMultistatus(xml: string, baseUrl: string): CalDavCalendarDescriptor[] {
  const responseRegex = /<(?:[a-zA-Z0-9_-]+:)?response(?:[\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?response>/gi
  const responses = xml.match(responseRegex) || []
  const calendars: CalDavCalendarDescriptor[] = []

  for (const resp of responses) {
    const href = extractXmlText(resp, 'href')
    if (!href) continue

    // Check if resource is a calendar (resourcetype has <calendar/>)
    const resourceType = extractXmlTagValue(resp, 'resourcetype') || ''
    const isCalendar = resourceType.toLowerCase().includes('calendar')

    if (!isCalendar) continue

    const displayName = extractXmlText(resp, 'displayname') || 'CalDAV Calendar'
    // Apple's calendar-color, which every server that has colours uses.
    const color = normalizeCalendarColor(extractXmlText(resp, 'calendar-color'))
    const ctag = extractXmlText(resp, 'getctag')
    const syncToken = extractXmlText(resp, 'sync-token')

    // Check if calendar is read-only (<current-user-privilege-set> lacks <write/>)
    const privs = extractXmlTagValue(resp, 'current-user-privilege-set') || ''
    const isReadOnly = privs ? !privs.toLowerCase().includes('write') : false

    // Resolve full calendar URL
    let fullHref = href
    if (href.startsWith('/')) {
      try {
        const parsedBase = new URL(baseUrl)
        fullHref = `${parsedBase.origin}${href}`
      } catch {
        fullHref = href
      }
    }

    calendars.push({
      href: fullHref,
      displayName,
      color,
      ctag,
      syncToken,
      isReadOnly
    })
  }

  return calendars
}

/**
 * Domains that hand out names to strangers - what the Public Suffix List calls
 * public suffixes - which a CalDAV server is often found under: dynamic DNS,
 * NAS makers' remote-access names, tunnels and hosting platforms. Not the whole
 * list (the app carries no copy of it), so a suffix missing here is still
 * caught if it is a country's own second level (`isSharedSuffix`). An entry
 * that is not a real suffix only costs a 401 from a sibling host; a real one
 * missing would hand one user's password to another's server.
 */
const SHARED_SUFFIXES = new Set([
  // Dynamic DNS
  'duckdns.org', 'dedyn.io', 'nsupdate.info', 'dynv6.net', 'dynu.net', 'freeddns.org', 'mywire.org',
  'ddns.net', 'hopto.org', 'zapto.org', 'sytes.net', 'myftp.org', 'no-ip.org', 'no-ip.biz', 'no-ip.info',
  'noip.me', 'dyndns.org', 'dyndns.biz', 'dyndns.info', 'homeip.net', 'homelinux.com', 'homelinux.net',
  'homelinux.org', 'mooo.com', 'us.to', 'ddnss.de', 'spdns.de', 'spdns.org', 'afraid.org',
  // Routers and NAS boxes
  'myfritz.net', 'synology.me', 'diskstation.me', 'dscloud.me', 'myds.me', 'dsmynas.com', 'familyds.com',
  'i234.me', 'myqnapcloud.com', 'asuscomm.com', 'tplinkdns.com', 'myasustor.com',
  // Tunnels and hosting
  'ts.net', 'ui.nabu.casa', 'ngrok.io', 'ngrok.app', 'ngrok-free.app', 'loca.lt', 'trycloudflare.com',
  'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev', 'workers.dev', 'herokuapp.com',
  'onrender.com', 'fly.dev', 'azurewebsites.net', 'cloudapp.net', 'appspot.com', 'web.app', 'firebaseapp.com'
])

/** The labels that make a country's second level - co.uk, com.au, com.vn, ac.jp. */
const COUNTRY_SECOND_LEVEL = new Set([
  'ac', 'biz', 'co', 'com', 'edu', 'gen', 'go', 'gob', 'gov', 'info', 'int', 'ltd', 'me', 'mil', 'ne', 'net',
  'nic', 'nom', 'or', 'org', 'plc', 'sch'
])

/** Whether every name directly under `domain` may belong to someone different. */
function isSharedSuffix(domain: string): boolean {
  const labels = domain.split('.')
  if (labels.length < 2 || SHARED_SUFFIXES.has(domain)) return true
  return labels.length === 2 && /^[a-z]{2}$/.test(labels[1]) && COUNTRY_SECOND_LEVEL.has(labels[0])
}

/**
 * Whether the account's password may go with a request to `requestUrl`.
 *
 * A server hands back addresses of its own - the calendar home, each event's
 * href - and the adapter used to send the password to whatever they named, so
 * a hostile or tampered-with server could point one at another host and
 * collect it. It goes to the account's host and to others in the same domain
 * (iCloud answers from pNN-caldav.icloud.com), and never over plain HTTP when
 * the account is HTTPS. "The same domain" is never a shared suffix:
 * alice.duckdns.org and bob.duckdns.org, or x.co.uk and y.co.uk, are two
 * strangers' servers.
 */
export function mayCarryCredentials(accountUrl: string, requestUrl: string): boolean {
  let account: URL
  let target: URL
  try {
    account = new URL(accountUrl)
    target = new URL(requestUrl)
  } catch {
    return false
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return false
  if (account.protocol === 'https:' && target.protocol !== 'https:') return false
  const host = account.hostname.toLowerCase()
  const other = target.hostname.toLowerCase()
  if (host === other) return true
  // An address, or a two-label name like example.com or nas.local: that host only.
  const labels = host.split('.')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || labels.length < 3) return false
  const domain = labels.slice(1).join('.')
  if (isSharedSuffix(domain)) return false
  return other === domain || other.endsWith(`.${domain}`)
}
