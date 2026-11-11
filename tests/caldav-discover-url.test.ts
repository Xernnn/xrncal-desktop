import { describe, it, expect } from 'vitest'
import {
  normalizeCalDavUrl,
  extractXmlTagValue,
  parseCalDavMultistatus
} from '../src/main/sync/caldav-discover'

describe('CalDAV URL Normalization & Discovery Parser', () => {
  describe('normalizeCalDavUrl', () => {
    it('should normalize iCloud URL to standard endpoint', () => {
      const url = normalizeCalDavUrl('icloud', undefined, 'user@icloud.com')
      expect(url).toBe('https://caldav.icloud.com')
    })

    it('should normalize Nextcloud host URL to include /remote.php/dav', () => {
      const url1 = normalizeCalDavUrl('nextcloud', 'cloud.mycompany.org')
      expect(url1).toBe('https://cloud.mycompany.org/remote.php/dav')

      const url2 = normalizeCalDavUrl('nextcloud', 'https://cloud.mycompany.org/remote.php/dav/')
      expect(url2).toBe('https://cloud.mycompany.org/remote.php/dav')
    })

    it('should normalize Synology URL to include /caldav/username', () => {
      const url = normalizeCalDavUrl('synology', 'https://nas.local:5001', 'admin_user')
      expect(url).toBe('https://nas.local:5001/caldav/admin_user')
    })

    it('should normalize generic CalDAV URL by trimming and enforcing protocol', () => {
      const url = normalizeCalDavUrl('generic', 'dav.example.com/calendars/user///')
      expect(url).toBe('https://dav.example.com/calendars/user')
    })
  })

  describe('extractXmlTagValue', () => {
    it('should extract tag content with or without namespace', () => {
      expect(extractXmlTagValue('<D:displayname>Personal</D:displayname>', 'displayname')).toBe('Personal')
      expect(extractXmlTagValue('<displayname>Work</displayname>', 'displayname')).toBe('Work')
      expect(extractXmlTagValue('<C:calendar-color>#6366f1</C:calendar-color>', 'calendar-color')).toBe('#6366f1')
    })
  })

  describe('parseCalDavMultistatus', () => {
    it('should parse XML multistatus response and extract calendar collections', () => {
      const sampleXml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>/remote.php/dav/calendars/john/personal/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
        <D:displayname>Personal Calendar</D:displayname>
        <C:calendar-color>#3b82f6</C:calendar-color>
        <CS:getctag>ctag-12345</CS:getctag>
        <D:sync-token>sync-token-999</D:sync-token>
        <D:current-user-privilege-set>
          <D:privilege><D:read/><D:write/></D:privilege>
        </D:current-user-privilege-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/remote.php/dav/addressbooks/john/contacts/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><CARD:addressbook xmlns:CARD="urn:ietf:params:xml:ns:carddav"/></D:resourcetype>
        <D:displayname>Contacts</D:displayname>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`

      const calendars = parseCalDavMultistatus(sampleXml, 'https://cloud.example.com')
      expect(calendars).toHaveLength(1)
      expect(calendars[0].href).toBe('https://cloud.example.com/remote.php/dav/calendars/john/personal/')
      expect(calendars[0].displayName).toBe('Personal Calendar')
      expect(calendars[0].color).toBe('#3b82f6')
      expect(calendars[0].ctag).toBe('ctag-12345')
      expect(calendars[0].syncToken).toBe('sync-token-999')
      expect(calendars[0].isReadOnly).toBe(false)
    })
  })
})

/**
 * A multistatus is read with patterns, and a pattern that looks for a closing
 * tag from every opening one reads the rest of the text each time when there
 * is none: 400 KB took a second, and the time grows with the square of the
 * size. Two megabytes - a hundredth of what a REPORT may send - held the main
 * process for half a minute. Both tests ran into the test timeout before.
 */
describe('a multistatus with elements that are never closed', () => {
  const twoMegabytes = (unit: string): string => unit.repeat(Math.ceil((2 * 1024 * 1024) / unit.length))

  it('is read in one pass when no response is closed', () => {
    const xml = `<d:multistatus xmlns:d="DAV:">${twoMegabytes('<d:response><d:href>/a/</d:href>')}`
    expect(parseCalDavMultistatus(xml, 'https://dav.example.com/')).toEqual([])
  })

  it('is read in one pass when a response is full of unclosed elements', () => {
    const response = `<d:response>${twoMegabytes('<d:href>')}</d:response>`
    expect(extractXmlTagValue(response, 'href')).toBeUndefined()
    expect(parseCalDavMultistatus(`<d:multistatus xmlns:d="DAV:">${response}</d:multistatus>`, 'https://dav.example.com/')).toEqual([])
  })

  it('still reads the responses that are whole, and stops at the first that is not', () => {
    const whole =
      '<d:response><d:href>/cal/</d:href><d:propstat><d:prop><d:resourcetype><c:calendar/></d:resourcetype>' +
      '<d:displayname>Home</d:displayname></d:prop><d:responsedescription>ok</d:responsedescription></d:propstat></d:response>'
    const calendars = parseCalDavMultistatus(`<d:multistatus>${whole}<d:response><d:href>/cut/</d:href>`, 'https://dav.example.com/')
    expect(calendars.map((c) => [c.href, c.displayName])).toEqual([['https://dav.example.com/cal/', 'Home']])
  })
})
