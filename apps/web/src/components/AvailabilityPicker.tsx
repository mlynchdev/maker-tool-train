import { useState, useMemo } from 'react'

interface Slot {
  time: string
}

interface AvailabilityPickerProps {
  slots: Slot[]
  onSelect: (slot: string) => void
  selectedSlot?: string
}

export function AvailabilityPicker({ slots, onSelect, selectedSlot }: AvailabilityPickerProps) {
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    if (slots.length > 0) {
      return new Date(slots[0].time).toISOString().split('T')[0]
    }
    return new Date().toISOString().split('T')[0]
  })

  // Group slots by date
  const slotsByDate = useMemo(() => {
    const grouped: Record<string, Slot[]> = {}
    for (const slot of slots) {
      const date = new Date(slot.time).toISOString().split('T')[0]
      if (!grouped[date]) {
        grouped[date] = []
      }
      grouped[date].push(slot)
    }
    return grouped
  }, [slots])

  const availableDates = Object.keys(slotsByDate).sort()
  const currentDateSlots = slotsByDate[selectedDate] || []

  const formatTime = (isoString: string) => {
    const date = new Date(isoString)
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString + 'T00:00:00')
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  }

  if (slots.length === 0) {
    return (
      <div className="alert alert-warning">
        No available slots found for the selected date range.
      </div>
    )
  }

  return (
    <div>
      {/* Date selector */}
      <div className="mb-2">
        <label className="form-label">Select Date</label>
        <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
          {availableDates.map((date) => (
            <button
              key={date}
              type="button"
              className={`btn ${date === selectedDate ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSelectedDate(date)}
            >
              {formatDate(date)}
            </button>
          ))}
        </div>
      </div>

      {/* Time slots */}
      <div className="mb-2">
        <label className="form-label">Select Time</label>
        <div className="availability-grid">
          {currentDateSlots.map((slot) => (
            <button
              key={slot.time}
              type="button"
              className={`availability-slot available ${slot.time === selectedSlot ? 'selected' : ''}`}
              onClick={() => onSelect(slot.time)}
            >
              {formatTime(slot.time)}
            </button>
          ))}
        </div>
      </div>

      {selectedSlot && (
        <div className="alert alert-info">
          Selected: {formatDate(new Date(selectedSlot).toISOString().split('T')[0])} at{' '}
          {formatTime(selectedSlot)}
        </div>
      )}
    </div>
  )
}
