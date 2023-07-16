import {HttpClient} from '@actions/http-client'
import md5 from 'blueimp-md5'
import ical, {ICalEventTransparency} from 'ical-generator'
import {parseStringPromise} from 'xml2js'

export interface Holiday {
  title: string
  year: number
  started_at: Date
  ended_at: Date
  shortened_day: boolean
}

export const getYears = async (): Promise<number[]> => {
  const response = await new HttpClient().get('http://xmlcalendar.ru/data/ru/all/calendar.json')

  if (response.message.statusCode !== 200) {
    throw new Error(response.message.statusMessage)
  }

  const data = JSON.parse(await response.readBody()) as {
    year: number
    months: {month: number; days: string}[]
    transitions: {from: string; to: string}[]
    statistic: {
      workdays: number
      holidays: number
      hours40: number
      hours36: number
      hours24: number
    }
  }[]

  return data.map(n => n.year)
}

export const getHolidays = async (year: number): Promise<Holiday[]> => {
  const response = await new HttpClient().get(`http://xmlcalendar.ru/data/ru/${year}/calendar.xml`)

  if (response.message.statusCode !== 200) {
    throw new Error(response.message.statusMessage)
  }

  const xml: {
    calendar: {
      $: {year: string; lang: string; date: string; country: string}
      holidays: {holiday: {$: {id: string; title: string}}[]}[]
      days: {day: {$: {d: string; t: string; h?: string; f?: string}}[]}[]
    }
  } = await parseStringPromise(await response.readBody())

  const days: {[key: number]: string} = []
  const data: Holiday[] = []
  const holidays: Holiday[] = []

  for (const holiday of xml.calendar.holidays[0].holiday) {
    days[+holiday.$.id] = holiday.$.title
  }

  for (const holiday of xml.calendar.days[0].day) {
    let title = holiday.$.h ? days[+holiday.$.h] : ''
    const parts = holiday.$.d.split('.')
    const date = new Date(`${year}-${parts[0]}-${parts[1]}`)

    if (!title && data.length > 0) {
      const diff = (date.getTime() - data[data.length - 1].started_at.getTime()) / (1000 * 3600 * 24)

      if (diff === 1) {
        title = data[data.length - 1].title
      } else if ((diff <= 3 && [0, 1].includes(date.getDay())) || (diff === 3 && [1, 2].includes(date.getDay()))) {
        title = data[data.length - 1].title

        if (!data[data.length - 1].shortened_day) {
          if (diff === 3) {
            data.push({
              title,
              year,
              started_at: addDays(date, -2),
              ended_at: date,
              shortened_day: false
            })
          }

          data.push({
            title,
            year,
            started_at: addDays(date, -1),
            ended_at: date,
            shortened_day: false
          })
        }
      }
    }

    data.push({
      title,
      year,
      started_at: date,
      ended_at: date,
      shortened_day: +holiday.$.t === 2
    })
  }

  for (const [key, holiday] of Object.entries(data).reverse()) {
    if (!holiday.title && +key !== data.length - 1) {
      holiday.title = data[+key + 1].title
    }

    const lastHoliday = holidays.filter(n => n.title === holiday.title).pop()
    let index = lastHoliday ? holidays.indexOf(lastHoliday) : -1

    if (
      addDays(holiday.started_at, 1).toISOString() !== holidays[index]?.started_at.toISOString() ||
      holiday.shortened_day !== holidays[index]?.shortened_day ||
      holiday.title !== holidays[index]?.title
    ) {
      index = -1
    }

    if (index === -1) {
      if (
        !holiday.title &&
        holiday.started_at.toISOString().slice(0, 10) >= `${year}-12-29` &&
        data[0].started_at.toISOString().startsWith(`${year}-01-01`)
      ) {
        holiday.title = data[0].title
      }

      holiday.ended_at = holiday.started_at
      holidays.push(holiday)
    } else {
      holidays[index].started_at = holiday.started_at
    }
  }

  return holidays.reverse().map(holiday => {
    if (!holiday.title) {
      holiday.title = holiday.started_at.toISOString() === holiday.ended_at.toISOString() ? 'Выходной' : 'Выходные'
    }
    if (holiday.shortened_day) {
      holiday.title = `* Сокращённый день (${holiday.title})`
    }

    return holiday
  })
}

export const createCalendar = (holidays: Holiday[]): string => {
  const calendar = ical({
    name: 'Производственный календарь',
    ttl: 86400
  })

  for (const holiday of holidays) {
    calendar.createEvent({
      summary: holiday.title,
      id: md5(
        `${holiday.title}${holiday.started_at.toISOString().slice(0, 10)}${holiday.ended_at.toISOString().slice(0, 10)}`
      ),
      stamp: new Date(`${holiday.year}-01-01T00:00:00Z`),
      start: holiday.started_at,
      end: addDays(holiday.ended_at, 1),
      allDay: true,
      transparency: ICalEventTransparency.TRANSPARENT
    })
  }

  return calendar.toString()
}

const addDays = (date: Date, days: number): Date => {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  )
}
