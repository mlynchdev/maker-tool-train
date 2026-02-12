import { eq } from 'drizzle-orm'
import { appSettings, db, type AppSetting } from '~/lib/db'

const MAKERSPACE_TIMEZONE_SETTING_KEY = 'makerspace.timezone'
const FALLBACK_MAKERSPACE_TIMEZONE = 'America/Los_Angeles'

type IntlWithSupportedValuesOf = typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[]
}

function getEnvTimezone() {
  const candidate = process.env.MAKERSPACE_TIMEZONE?.trim()
  if (!candidate) return null
  return isValidIanaTimezone(candidate) ? candidate : null
}

export function isValidIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date())
    return true
  } catch {
    return false
  }
}

export function getDefaultMakerspaceTimezone() {
  return getEnvTimezone() || FALLBACK_MAKERSPACE_TIMEZONE
}

export function getSupportedIanaTimezones() {
  const intlApi = Intl as IntlWithSupportedValuesOf
  if (typeof intlApi.supportedValuesOf === 'function') {
    return intlApi.supportedValuesOf('timeZone')
  }

  return [
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Phoenix',
    'America/Anchorage',
    'Pacific/Honolulu',
    'UTC',
  ]
}

export async function getMakerspaceTimezone() {
  const setting = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, MAKERSPACE_TIMEZONE_SETTING_KEY),
  })

  if (setting && isValidIanaTimezone(setting.value)) {
    return setting.value
  }

  return getDefaultMakerspaceTimezone()
}

export async function setMakerspaceTimezone(timezone: string): Promise<AppSetting> {
  if (!isValidIanaTimezone(timezone)) {
    throw new Error('Invalid timezone')
  }

  const [setting] = await db
    .insert(appSettings)
    .values({
      key: MAKERSPACE_TIMEZONE_SETTING_KEY,
      value: timezone,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        value: timezone,
        updatedAt: new Date(),
      },
    })
    .returning()

  return setting
}
