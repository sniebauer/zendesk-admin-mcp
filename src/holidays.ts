/**
 * Idempotency for zda_set_holidays. The annual refresh is re-run by hand and can
 * fail partway through a large batch (429), so "already there" must be detected
 * rather than duplicated. Pure — no I/O — so it is unit-testable directly.
 */

export interface HolidayInput {
  name: string;
  start_date: string;
  end_date: string;
}

export interface ExistingHoliday extends HolidayInput {
  id: number;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** Identity is the (name, start_date, end_date) triple — Zendesk has no natural key. */
export function holidayMatches(a: HolidayInput, b: ExistingHoliday): boolean {
  return (
    normalizeName(a.name) === normalizeName(b.name) &&
    a.start_date === b.start_date &&
    a.end_date === b.end_date
  );
}

export function planHolidays(
  desired: HolidayInput[],
  existing: ExistingHoliday[]
): { toCreate: HolidayInput[]; skipped: HolidayInput[] } {
  const toCreate: HolidayInput[] = [];
  const skipped: HolidayInput[] = [];
  // Treat items already queued for creation as present, so a duplicated entry in
  // the caller's own list doesn't produce two identical holidays.
  const seen: ExistingHoliday[] = [...existing];

  for (const holiday of desired) {
    if (seen.some((e) => holidayMatches(holiday, e))) {
      skipped.push(holiday);
      continue;
    }
    toCreate.push(holiday);
    seen.push({ id: -1, ...holiday });
  }

  return { toCreate, skipped };
}
