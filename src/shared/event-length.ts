import type { DateTime } from 'luxon'
import { DEFAULT_APP_SETTINGS, type AppSettings } from './settings-contract'

/**
 * How long a new timed event is when nothing has said: a click on an empty
 * slot, "New event here", the Create button, N. Every one of those used to
 * write an hour of its own; they now ask here, with the length chosen in
 * Settings (`defaultEventMinutes`). A range that was dragged is a range of its
 * own and never comes through here.
 */
export type EventLengthMinutes = AppSettings['defaultEventMinutes']

/** The lengths offered in Settings. */
export const EVENT_LENGTH_OPTIONS: readonly EventLengthMinutes[] = [15, 30, 45, 60, 90, 120]

/**
 * The stored length, or an hour when what is stored is not one of the lengths
 * offered. Settings are read back as whatever was written, and a length of 0
 * (or text) would open every new event on a range that ends where it starts,
 * which the editor refuses to save.
 */
export function newEventMinutes(setting: unknown): EventLengthMinutes {
  return EVENT_LENGTH_OPTIONS.find((option) => option === setting) ?? DEFAULT_APP_SETTINGS.defaultEventMinutes
}

/**
 * Where a new event starting at `start` ends. Late in the evening that is
 * after midnight, on the next day, as an hour from 23:30 always was: the
 * editor rolls the end date the same way, and the grid draws such an event
 * across both days.
 */
export function newEventEnd(start: DateTime, setting: unknown): DateTime {
  return start.plus({ minutes: newEventMinutes(setting) })
}
