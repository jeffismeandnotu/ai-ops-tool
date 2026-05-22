import { google } from "googleapis";
import { BUSINESS } from "@/config/business";

export function getCalendarClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth });
}

// --- Read ---
export async function listEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  calendarId = "primary"
) {
  const cal = getCalendarClient(accessToken);
  const res = await cal.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    timeZone: BUSINESS.timezone,
  });
  return res.data.items || [];
}

export async function getEvent(
  accessToken: string,
  eventId: string,
  calendarId = "primary"
) {
  const cal = getCalendarClient(accessToken);
  const res = await cal.events.get({ calendarId, eventId });
  return res.data;
}

// --- Write ---
export async function createEvent(
  accessToken: string,
  params: {
    summary: string;
    description?: string;
    location?: string;
    startTime: string; // ISO
    endTime: string; // ISO
    attendeeEmails?: string[];
    colorId?: string;
    reminders?: { method: string; minutes: number }[];
  },
  calendarId = "primary"
) {
  const cal = getCalendarClient(accessToken);

  const event: any = {
    summary: params.summary,
    description: params.description,
    location: params.location,
    start: {
      dateTime: params.startTime,
      timeZone: BUSINESS.timezone,
    },
    end: {
      dateTime: params.endTime,
      timeZone: BUSINESS.timezone,
    },
    colorId: params.colorId,
  };

  if (params.attendeeEmails?.length) {
    event.attendees = params.attendeeEmails.map((email) => ({ email }));
  }

  if (params.reminders?.length) {
    event.reminders = {
      useDefault: false,
      overrides: params.reminders,
    };
  }

  const res = await cal.events.insert({
    calendarId,
    requestBody: event,
    sendUpdates: "all",
  });

  return res.data;
}

export async function updateEvent(
  accessToken: string,
  eventId: string,
  updates: {
    summary?: string;
    description?: string;
    location?: string;
    startTime?: string;
    endTime?: string;
    colorId?: string;
  },
  calendarId = "primary"
) {
  const cal = getCalendarClient(accessToken);

  const patch: any = {};
  if (updates.summary) patch.summary = updates.summary;
  if (updates.description) patch.description = updates.description;
  if (updates.location) patch.location = updates.location;
  if (updates.startTime)
    patch.start = { dateTime: updates.startTime, timeZone: BUSINESS.timezone };
  if (updates.endTime)
    patch.end = { dateTime: updates.endTime, timeZone: BUSINESS.timezone };
  if (updates.colorId) patch.colorId = updates.colorId;

  const res = await cal.events.patch({
    calendarId,
    eventId,
    requestBody: patch,
    sendUpdates: "all",
  });

  return res.data;
}

export async function deleteEvent(
  accessToken: string,
  eventId: string,
  calendarId = "primary"
) {
  const cal = getCalendarClient(accessToken);
  await cal.events.delete({
    calendarId,
    eventId,
    sendUpdates: "all",
  });
}

// --- Availability ---
export async function findFreeSlots(
  accessToken: string,
  date: string, // YYYY-MM-DD
  durationMinutes: number
): Promise<{ start: string; end: string }[]> {
  const { workingHours, bufferMinutes } = BUSINESS.calendar;

  const dayStart = `${date}T${workingHours.start}:00`;
  const dayEnd = `${date}T${workingHours.end}:00`;

  const events = await listEvents(
    accessToken,
    new Date(`${dayStart}-07:00`).toISOString(),
    new Date(`${dayEnd}-07:00`).toISOString()
  );

  // Build occupied slots
  const occupied = events
    .filter((e: any) => e.start?.dateTime && e.end?.dateTime)
    .map((e: any) => ({
      start: new Date(e.start.dateTime).getTime(),
      end: new Date(e.end.dateTime).getTime() + bufferMinutes * 60 * 1000,
    }))
    .sort((a, b) => a.start - b.start);

  // Find free slots
  const freeSlots: { start: string; end: string }[] = [];
  let cursor = new Date(`${dayStart}-07:00`).getTime();
  const endOfDay = new Date(`${dayEnd}-07:00`).getTime();
  const needed = durationMinutes * 60 * 1000;

  for (const occ of occupied) {
    if (occ.start - cursor >= needed) {
      freeSlots.push({
        start: new Date(cursor).toISOString(),
        end: new Date(cursor + needed).toISOString(),
      });
    }
    cursor = Math.max(cursor, occ.end);
  }

  // Check after last event
  if (endOfDay - cursor >= needed) {
    freeSlots.push({
      start: new Date(cursor).toISOString(),
      end: new Date(cursor + needed).toISOString(),
    });
  }

  return freeSlots;
}

export async function listCalendars(accessToken: string) {
  const cal = getCalendarClient(accessToken);
  const res = await cal.calendarList.list();
  return res.data.items || [];
}
