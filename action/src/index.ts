import * as core from '@actions/core'
import * as dotenv from 'dotenv'
import {existsSync, readFileSync, writeFileSync} from 'fs'
import {createCalendar, getHolidays, getYears} from './calendar'
import {resolve} from 'path'

import type {Holiday} from './calendar'

async function run(): Promise<void> {
  try {
    dotenv.config()

    const dir = core.getInput('working_directory') || '.'
    const token = core.getInput('token', {required: true})
    let allHolidays: Holiday[] = []
    const changes: {[key: number]: 'update' | 'create'} = []

    for (const year of await getYears(token)) {
      const holidays = await getHolidays(token, year)
      const calendar = createCalendar(holidays)

      allHolidays = allHolidays.concat(holidays)

      const filename = resolve(`${dir}/../years/holidays_${year}.ics`)
      const currentCalendar = existsSync(filename) ? readFileSync(filename).toString() : null

      if (currentCalendar !== calendar) {
        writeFileSync(filename, calendar)

        changes[year] = currentCalendar ? 'update' : 'create'
      }
    }

    if (Object.keys(changes).length === 0) {
      core.info('no changes')

      return
    }

    const calendar = createCalendar(allHolidays)

    writeFileSync(resolve(`${dir}/../holidays.ics`), calendar)

    let commitMessage = 'Update calendar'

    for (const [year, action] of Object.entries(changes)) {
      commitMessage += `\n\n* ${action} calendar for ${year}`
      core.info(`${action} calendar for ${year}`)
    }

    core.setOutput('commit_message', commitMessage)
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
