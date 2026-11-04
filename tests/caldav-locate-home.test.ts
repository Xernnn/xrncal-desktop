import { describe, it, expect, vi, afterEach } from 'vitest'
import { CalDavAdapter } from '../src/main/sync/caldav-adapter'
import {
  defaultCalDavName,
  extractPropHref,
  extractXmlText,
  mayCarryCredentials,
  normalizeCalendarColor,
  resolveDavHref
} from '../src/main/sync/caldav-discover'

/**
 * A bare server address used to "connect" and then show nothing, because the
 * calendars live under the user's calendar home, one or two levels down.
 * These fake servers answer the way Radicale and a well-known-only server do.
 */

const ms = (body: string) => `<?xml version="1.0"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${body}</multistatus>`

const collection = (href: string, extraType = '', props = '') =>
  `<response><href>${href}</href><propstat><prop><resourcetype><collection/>${extraType}</resourcetype>${props}</prop><status>HTTP/1.1 200 OK</status></propstat></response>`

type Route = (depth: string, body: string) => { status: number; xml?: string; finalUrl?: string }

/** fetch for a fake server: routes keyed by absolute URL. */
function fakeServer(routes: Record<string, Route>) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    const depth = headers.Depth
    const body = String(init.body ?? '')
    calls.push(`${init.method} ${url} depth=${depth}`)
    const route = routes[url]
    if (!route) return new Response('not found', { status: 404 })
    const { status, xml, finalUrl } = route(depth, body)
    const res = new Response(xml ?? '', { status })
    // fetch reports where a redirect ended up; a constructed Response cannot.
    if (finalUrl) Object.defineProperty(res, 'url', { value: finalUrl })
    return res
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

const creds = (url: string) => ({ url, username: 'sonn', password: 'pw' })

afterEach(() => vi.unstubAllGlobals())

describe('CalDavAdapter.locateCalendarHome', () => {
  it('follows a bare server address to the calendars, like Radicale at its root', async () => {
    const base = 'https://homeserver.example.ts.net'
    fakeServer({
      [`${base}/`]: (depth, body) =>
        depth === '1'
          ? { status: 207, xml: ms(collection('/') + collection('/sonn/', '<principal/>')) }
          : body.includes('current-user-principal')
            ? { status: 207, xml: ms(`<response><href>/</href><propstat><prop><current-user-principal><href>/sonn/</href></current-user-principal></prop></propstat></response>`) }
            : { status: 404 },
      [`${base}/sonn/`]: (depth, body) =>
        depth === '0' && body.includes('calendar-home-set')
          ? { status: 207, xml: ms(`<response><href>/sonn/</href><propstat><prop><C:calendar-home-set><href>/sonn/</href></C:calendar-home-set></prop></propstat></response>`) }
          : depth === '1'
            ? {
                status: 207,
                xml: ms(
                  collection('/sonn/', '<principal/>') +
                    collection(
                      '/sonn/personal/',
                      '<C:calendar/>',
                      '<displayname>Personal</displayname><current-user-privilege-set><privilege><write/></privilege></current-user-privilege-set>'
                    )
                )
              }
            : { status: 404 }
    })

    const found = await new CalDavAdapter(creds(`${base}/`)).locateCalendarHome()

    expect(found.url).toBe(`${base}/sonn/`)
    expect(found.calendars.map((c) => [c.displayName, c.href, c.isReadOnly])).toEqual([
      ['Personal', `${base}/sonn/personal/`, false]
    ])
  })

  it('stops at the address when calendars are already there', async () => {
    const home = 'https://dav.example.com/calendars/sonn'
    const calls = fakeServer({
      [home]: () => ({
        status: 207,
        xml: ms(collection('/calendars/sonn/work/', '<C:calendar/>', '<displayname>Work</displayname>'))
      })
    })

    const found = await new CalDavAdapter(creds(home)).locateCalendarHome()

    expect(found.url).toBe(home)
    expect(found.calendars.map((c) => c.displayName)).toEqual(['Work'])
    expect(calls).toHaveLength(1)
  })

  it('asks /.well-known/caldav when the address does not name a principal', async () => {
    const base = 'https://cloud.example.com'
    fakeServer({
      [`${base}/`]: () => ({ status: 403 }),
      [`${base}/.well-known/caldav`]: (_depth, body) =>
        body.includes('current-user-principal')
          ? {
              status: 207,
              // fetch followed the redirect to the DAV root.
              finalUrl: `${base}/remote.php/dav/`,
              xml: ms(`<response><href>/remote.php/dav/</href><propstat><prop><current-user-principal><href>principals/users/sonn/</href></current-user-principal></prop></propstat></response>`)
            }
          : { status: 404 },
      [`${base}/remote.php/dav/principals/users/sonn/`]: () => ({
        status: 207,
        xml: ms(`<response><href>/remote.php/dav/principals/users/sonn/</href><propstat><prop><C:calendar-home-set><href>https://cloud.example.com/remote.php/dav/calendars/sonn/</href></C:calendar-home-set></prop></propstat></response>`)
      }),
      [`${base}/remote.php/dav/calendars/sonn/`]: () => ({
        status: 207,
        xml: ms(collection('/remote.php/dav/calendars/sonn/personal/', '<C:calendar/>', '<displayname>Personal</displayname>'))
      })
    })

    const found = await new CalDavAdapter(creds(`${base}/`)).locateCalendarHome()

    expect(found.url).toBe(`${base}/remote.php/dav/calendars/sonn/`)
    expect(found.calendars.map((c) => c.displayName)).toEqual(['Personal'])
  })

  it('reports a wrong password instead of carrying on to find nothing', async () => {
    fakeServer({ 'https://dav.example.com/': () => ({ status: 401, xml: 'Unauthorized' }) })

    await expect(new CalDavAdapter(creds('https://dav.example.com/')).locateCalendarHome()).rejects.toThrow(
      /HTTP 401/
    )
  })

  it('comes back empty-handed when the server has no principal to follow', async () => {
    fakeServer({ 'https://dav.example.com/': (depth) => ({ status: 207, xml: ms(depth === '1' ? collection('/') : '') }) })

    const found = await new CalDavAdapter(creds('https://dav.example.com/')).locateCalendarHome()

    expect(found).toEqual({ url: 'https://dav.example.com/', calendars: [] })
  })
})

describe('discovery helpers', () => {
  it('reads the href a property points at', () => {
    const xml = '<d:current-user-principal><d:href>/sonn/</d:href></d:current-user-principal>'
    expect(extractPropHref(xml, 'current-user-principal')).toBe('/sonn/')
    expect(extractPropHref(xml, 'calendar-home-set')).toBeUndefined()
  })

  it('resolves relative, rooted and absolute hrefs', () => {
    expect(resolveDavHref('principals/u/', 'https://a.example/remote.php/dav/')).toBe(
      'https://a.example/remote.php/dav/principals/u/'
    )
    expect(resolveDavHref('/sonn/', 'https://a.example/x/')).toBe('https://a.example/sonn/')
    expect(resolveDavHref('https://p01.example/123/', 'https://a.example/')).toBe('https://p01.example/123/')
  })

  it('names an unnamed account after its server', () => {
    expect(defaultCalDavName('generic', 'https://homeserver.example.ts.net/')).toBe('homeserver.example.ts.net')
    expect(defaultCalDavName('nextcloud', 'https://cloud.example.com/remote.php/dav')).toBe('cloud.example.com')
    expect(defaultCalDavName('icloud', 'https://caldav.icloud.com')).toBe('iCloud')
  })
})

describe('calendar colours', () => {
  it("asks for Apple's calendar-color, which is where servers keep it", async () => {
    // Asked for in the CalDAV namespace, Radicale answered 404 for the property
    // and every calendar discovered later came in the default green.
    const url = 'https://homeserver.example.ts.net/sonn/'
    let asked = ''
    fakeServer({
      [url]: (_depth, body) => {
        asked = body
        return {
          status: 207,
          xml: `<?xml version="1.0"?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:I="http://apple.com/ns/ical/">${collection('/sonn/work/', '<C:calendar/>', '<displayname>Work</displayname><I:calendar-color>#039BE5</I:calendar-color>')}</multistatus>`
        }
      }
    })
    const [work] = await new CalDavAdapter(creds(url)).discoverCalendars()
    expect(asked).toMatch(/xmlns:I="http:\/\/apple.com\/ns\/ical\/"[\s\S]*<I:calendar-color\/>/)
    expect(work).toMatchObject({ displayName: 'Work', color: '#039be5' })
  })

  it('keeps only real colours from a server', () => {
    expect(normalizeCalendarColor('#039BE5')).toBe('#039be5')
    expect(normalizeCalendarColor('#7c9cbfff')).toBe('#7c9cbf')
    expect(normalizeCalendarColor(' #abc ')).toBe('#aabbcc')
    expect(normalizeCalendarColor('red; background-image: url(https://example.com/x)')).toBeUndefined()
    expect(normalizeCalendarColor('url(x)')).toBeUndefined()
    expect(normalizeCalendarColor(undefined)).toBeUndefined()
  })

  it('reads a character reference past Unicode as a replacement, not a crash', () => {
    expect(extractXmlText('<displayname>A&#99999999;B&#x41;</displayname>', 'displayname')).toBe('A�BA')
  })
})

describe('where the CalDAV password goes', () => {
  it('only to the account\'s server and its own domain, never down to plain HTTP', () => {
    const home = 'https://homeserver.tail12bde9.ts.net/sonn/'
    expect(mayCarryCredentials(home, 'https://homeserver.tail12bde9.ts.net/sonn/work/x.ics')).toBe(true)
    expect(mayCarryCredentials(home, 'https://other.tail12bde9.ts.net/sonn/')).toBe(true)
    expect(mayCarryCredentials(home, 'https://evil.example/collect')).toBe(false)
    expect(mayCarryCredentials(home, 'https://ts.net.evil.example/')).toBe(false)
    expect(mayCarryCredentials(home, 'http://homeserver.tail12bde9.ts.net/sonn/')).toBe(false)
    expect(mayCarryCredentials(home, 'file:///etc/passwd')).toBe(false)
    // iCloud answers from per-user hosts in its own domain.
    expect(mayCarryCredentials('https://caldav.icloud.com', 'https://p42-caldav.icloud.com/123/calendars/')).toBe(true)
    // A two-label name or an address: that host only.
    expect(mayCarryCredentials('https://example.com/dav/', 'https://cal.example.com/dav/')).toBe(false)
    expect(mayCarryCredentials('http://192.168.1.5:5232/', 'http://192.168.1.5:5232/sonn/')).toBe(true)
    expect(mayCarryCredentials('http://192.168.1.5:5232/', 'http://192.168.1.6:5232/sonn/')).toBe(false)
  })

  it('leaves the password off a request to a host a server named', async () => {
    const url = 'https://homeserver.example.ts.net/sonn/'
    const seen: Record<string, string | undefined> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (target: string, init: RequestInit) => {
        seen[target] = (init.headers as Record<string, string>).Authorization
        return new Response('', { status: 401 })
      })
    )
    const adapter = new CalDavAdapter(creds(url))
    // An href the server listed, pointing at another host.
    await adapter.deleteEvent(`${url}work/`, 'x', 'https://evil.example/collect.ics').catch(() => {})
    await adapter.deleteEvent(`${url}work/`, 'x', `${url}work/x.ics`).catch(() => {})
    expect(seen['https://evil.example/collect.ics']).toBeUndefined()
    expect(seen[`${url}work/x.ics`]).toMatch(/^Basic /)
  })
})
