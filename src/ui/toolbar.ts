// The flight toolbar: Fly (Restart, Fly again), Pause (Resume), the
// simulation speed segmented control, the Course number field and New course,
// built from native controls.

import { SPEEDS, flyLabel, inFlight, pauseEnabled, pauseLabel, type Phase, type Speed } from './flight.ts'
import { validCourse } from './persistence.ts'

export interface ToolbarHandlers {
  fly(): void
  togglePause(): void
  setSpeed(speed: Speed): void
  /** A valid course number, different from the current one, was entered. */
  setCourse(course: number): void
  newCourse(): void
}

export interface Toolbar {
  readonly element: HTMLElement
  /**
   * Reflects the phase, speed and course into labels, values, `disabled` and
   * `aria-pressed`; unchanged values are not rewritten, so typing is never clobbered.
   */
  update(phase: Phase, speed: Speed, course: number): void
}

const COURSE_FIELD_ID = 'course-field'

function button(doc: Document, className: string): HTMLButtonElement {
  const b = doc.createElement('button')
  b.type = 'button'
  b.className = className
  return b
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

export function createToolbar(doc: Document, handlers: ToolbarHandlers): Toolbar {
  const element = doc.createElement('div')
  element.className = 'toolbar'

  const fly = button(doc, 'btn btn-primary')
  fly.addEventListener('click', () => handlers.fly())

  const pause = button(doc, 'btn')
  pause.addEventListener('click', () => handlers.togglePause())

  const seg = doc.createElement('div')
  seg.className = 'seg'
  seg.setAttribute('role', 'group')
  seg.setAttribute('aria-label', 'Simulation speed')
  const speedButtons = SPEEDS.map((speed) => {
    const b = button(doc, 'seg-btn')
    b.textContent = `×${speed}`
    b.addEventListener('click', () => handlers.setSpeed(speed))
    seg.append(b)
    return { speed, b }
  })

  const courseLabel = doc.createElement('label')
  courseLabel.className = 'course-label'
  courseLabel.htmlFor = COURSE_FIELD_ID
  courseLabel.textContent = 'Course'
  const courseField = doc.createElement('input')
  courseField.type = 'text'
  courseField.id = COURSE_FIELD_ID
  courseField.className = 'course-field'
  courseField.inputMode = 'numeric'
  courseField.autocomplete = 'off'
  courseField.setAttribute('aria-label', 'Course number')
  courseLabel.append(courseField)

  const newCourse = button(doc, 'btn')
  newCourse.textContent = 'New course'
  newCourse.addEventListener('click', () => handlers.newCourse())

  /** The course last shown in the field; undefined until the first update. */
  let shownCourse: number | undefined

  courseField.addEventListener('change', () => {
    const text = courseField.value.trim()
    const course = /^\d+$/.test(text) ? Number(text) : NaN
    if (validCourse(course) && course !== shownCourse) handlers.setCourse(course)
    // An accepted course is already shown; a rejected, same or invalid one shows the current course again.
    if (shownCourse !== undefined) courseField.value = String(shownCourse)
  })

  element.append(fly, pause, seg, courseLabel, newCourse)

  return {
    element,
    update(phase, speed, course) {
      setText(fly, flyLabel(phase))
      setText(pause, pauseLabel(phase))
      const disabled = !pauseEnabled(phase)
      if (pause.disabled !== disabled) {
        // A disabled button loses focus to the page, so hand it to Fly first.
        if (disabled && doc.activeElement === pause) fly.focus()
        pause.disabled = disabled
      }
      for (const { speed: s, b } of speedButtons) {
        const pressed = String(s === speed)
        if (b.getAttribute('aria-pressed') !== pressed) b.setAttribute('aria-pressed', pressed)
      }
      if (course !== shownCourse) {
        shownCourse = course
        courseField.value = String(course)
      }
      const locked = inFlight(phase)
      if (courseField.disabled !== locked || newCourse.disabled !== locked) {
        // A disabled control loses focus to the page, so hand it to Fly first.
        if (locked && (doc.activeElement === courseField || doc.activeElement === newCourse)) fly.focus()
        courseField.disabled = locked
        newCourse.disabled = locked
      }
    },
  }
}
