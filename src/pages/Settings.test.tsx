import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router'
import { AuthContext } from '@/contexts/AuthContext'
import userEvent from '@testing-library/user-event'
import Settings from './Settings'
import type { ReactNode } from 'react'

// Mock assets
vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))
vi.mock('@/assets/guava-icon.png', () => ({ default: 'icon.png' }))

// Mock the api module
const mockGet = vi.fn()
const mockPut = vi.fn()
vi.mock('@/lib/api', () => {
  return {
    default: {
      get: (...args: unknown[]) => mockGet(...args),
      post: vi.fn(),
      put: (...args: unknown[]) => mockPut(...args),
      patch: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
      defaults: { baseURL: 'http://localhost:5000/api' },
    },
  }
})

function renderWithAuth(ui: ReactNode, { role = 'owner' }: { role?: 'owner' | 'manager' } = {}) {
  const user = {
    id: 'user123',
    email: 'test@yourguava.com',
    name: role === 'owner' ? 'Test Owner' : 'Test Manager',
    role,
    orgId: 'org123',
    cafeIds: ['cafe123'],
    activeCafeId: 'cafe123',
  }

  return render(
    <BrowserRouter>
      <AuthContext.Provider
        value={{
          user,
          isLoading: false,
          isOwner: role === 'owner',
          login: vi.fn(),
          logout: vi.fn(),
          register: vi.fn(),
          switchCafe: vi.fn(),
        }}
      >
        {ui}
      </AuthContext.Provider>
    </BrowserRouter>
  )
}

describe('Settings', () => {
const cafeWithTimezone = (timezoneEditable: boolean) => (url: string) => {
  if (url.includes('/cafe/me')) {
    return Promise.resolve({
      data: {
        success: true,
        cafe: { name: 'Cafe X', location: { city: 'London' }, timezone: 'Africa/Johannesburg', timezoneEditable },
      },
    })
  }
  return Promise.resolve({ data: {} })
}

it('lets the owner choose a timezone before the first import', async () => {
  mockGet.mockImplementation(cafeWithTimezone(true))
  mockPut.mockResolvedValueOnce({ data: { success: true } })
  renderWithAuth(<Settings />)

  fireEvent.click(await screen.findByRole('button', { name: /edit cafe details/i }))
  const select = (await screen.findByLabelText(/^Timezone$/i)) as HTMLSelectElement
  expect(select.value).toBe('Africa/Johannesburg')
  fireEvent.change(select, { target: { value: 'Europe/London' } })
  fireEvent.click(screen.getByText('Save Cafe Details'))

  await waitFor(() => {
    expect(mockPut).toHaveBeenCalledWith('/cafe/me', expect.objectContaining({ timezone: 'Europe/London' }))
  })
})

it('says the timezone is fixed once sales exist, and does not send it', async () => {
  mockGet.mockImplementation(cafeWithTimezone(false))
  mockPut.mockResolvedValueOnce({ data: { success: true } })
  renderWithAuth(<Settings />)

  fireEvent.click(await screen.findByRole('button', { name: /edit cafe details/i }))
  expect(await screen.findByText(/fixed once sales are imported/i)).toBeInTheDocument()
  expect(screen.queryByLabelText(/^Timezone$/i)).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText(/^Cafe Name$/i), { target: { value: 'Cafe Y' } })
  fireEvent.click(screen.getByText('Save Cafe Details'))

  await waitFor(() => expect(mockPut).toHaveBeenCalled())
  expect(mockPut.mock.calls[0][1]).not.toHaveProperty('timezone')
})

it('shows the server reason when a timezone is refused', async () => {
  mockGet.mockImplementation(cafeWithTimezone(true))
  mockPut.mockRejectedValueOnce({
    response: { status: 400, data: { success: false, code: 'INVALID_TIMEZONE', message: 'Choose a timezone from the list, such as Africa/Johannesburg.' } },
  })
  renderWithAuth(<Settings />)

  fireEvent.click(await screen.findByRole('button', { name: /edit cafe details/i }))
  fireEvent.change(await screen.findByLabelText(/^Timezone$/i), { target: { value: 'Europe/London' } })
  fireEvent.click(screen.getByText('Save Cafe Details'))

  expect(await screen.findByRole('alert')).toHaveTextContent(/choose a timezone from the list/i)
})

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    window.history.pushState({}, '', '/settings')
  })

  it('keeps settings read-only when the cafe snapshot cannot be loaded', async () => {
    mockGet.mockRejectedValue(new Error('network unavailable'))

    renderWithAuth(<Settings />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/settings are unavailable/i)
    expect(screen.getByRole('button', { name: /edit cafe details/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /edit trading hours/i })).toBeDisabled()
    expect(screen.queryByText('My Cafe')).not.toBeInTheDocument()
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('renders cafe details in view mode by default', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({
          data: {
            success: true,
            cafe: { name: 'Blouberg Coffee', location: { address: '123 Main St', city: 'Cape Town' } },
          },
        })
      }
      if (url.includes('/events')) {
        return Promise.resolve({ data: { events: [] } })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Settings />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /edit cafe details/i })).toBeInTheDocument()
    })

    expect(screen.queryByText('My Account')).not.toBeInTheDocument()
    expect(screen.queryByText('Plans and mock checkout')).not.toBeInTheDocument()

    expect(screen.getAllByText('Blouberg Coffee').length).toBeGreaterThan(0)
    expect(screen.getByText('123 Main St')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Blouberg Coffee')).not.toBeInTheDocument()
    expect(screen.queryByText('Save Cafe Details')).not.toBeInTheDocument()
  })

  it('shows managers the cafe details and trading hours read-only, without edit controls', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({
          data: {
            success: true,
            cafe: { name: 'Manager View Cafe', location: { address: '9 Kloof St', city: 'Cape Town' } },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Settings />, { role: 'manager' })

    expect(await screen.findByText('9 Kloof St')).toBeInTheDocument()
    expect(screen.getAllByText('Manager View Cafe').length).toBeGreaterThan(0)
    expect(screen.getByText('Trading Hours')).toBeInTheDocument()
    expect(screen.getByText('Monday')).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: /edit cafe details/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit trading hours/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Save Cafe Details')).not.toBeInTheDocument()
    expect(screen.queryByText('Save Trading Hours')).not.toBeInTheDocument()
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('keeps the settings section menu fixed on desktop', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({
          data: {
            success: true,
            cafe: { name: 'Pinned Cafe', location: { address: '', city: 'Cape Town' } },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Settings />)

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: /settings sections/i })).toBeInTheDocument()
    })

    expect(screen.getByRole('navigation', { name: /settings sections/i }).closest('aside')).toHaveClass(
      'xl:fixed',
      'xl:top-20',
      'xl:w-[220px]'
    )
  })

  it('renders the expanded address block and timezone in view mode', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({
          data: {
            success: true,
            cafe: {
              name: 'Sea Point Roastery',
              location: {
                address: '12 Beach Road',
                addressLine2: 'Shop 4',
                suburb: 'Sea Point',
                city: 'Cape Town',
                postalCode: '8005',
                province: 'Western Cape',
                country: 'South Africa',
                lat: -33.9249,
                lng: 18.4241,
              },
              timezone: 'Africa/Johannesburg',
            },
          },
        })
      }
      if (url.includes('/events')) {
        return Promise.resolve({ data: { events: [] } })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Settings />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /edit cafe details/i })).toBeInTheDocument()
    })

    expect(screen.getByText('12 Beach Road')).toBeInTheDocument()
    expect(screen.getByText('Shop 4')).toBeInTheDocument()
    expect(screen.getByText(/Sea Point, Cape Town, 8005/)).toBeInTheDocument()
    expect(screen.getByText(/Western Cape, South Africa/)).toBeInTheDocument()
    expect(screen.getByText('-33.9249')).toBeInTheDocument()
    expect(screen.getByText('18.4241')).toBeInTheDocument()
    expect(screen.getByText('Africa/Johannesburg')).toBeInTheDocument()
  })

  it('saves the expanded location payload', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({
          data: {
            success: true,
            cafe: {
              name: 'Cafe X',
              location: { address: '', city: 'Cape Town', country: 'South Africa' },
              timezone: 'Africa/Johannesburg',
            },
          },
        })
      }
      if (url.includes('/events')) {
        return Promise.resolve({ data: { events: [] } })
      }
      return Promise.resolve({ data: {} })
    })

    mockPut.mockResolvedValueOnce({ data: { success: true } })

    renderWithAuth(<Settings />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /edit cafe details/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /edit cafe details/i }))

    const suburb = await screen.findByLabelText(/^Suburb$/i)
    fireEvent.change(suburb, { target: { value: 'Sea Point' } })

    const postal = screen.getByLabelText(/^Postal Code$/i)
    fireEvent.change(postal, { target: { value: '8005' } })

    const province = screen.getByLabelText(/^Province$/i) as HTMLSelectElement
    fireEvent.change(province, { target: { value: 'Western Cape' } })

    fireEvent.change(screen.getByLabelText(/^Latitude$/i), { target: { value: '-33.9249' } })
    fireEvent.change(screen.getByLabelText(/^Longitude$/i), { target: { value: '18.4241' } })

    fireEvent.click(screen.getByText('Save Cafe Details'))

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith(
        '/cafe/me',
        expect.objectContaining({
          location: expect.objectContaining({
            suburb: 'Sea Point',
            postalCode: '8005',
            province: 'Western Cape',
            country: 'South Africa',
            lat: -33.9249,
            lng: 18.4241,
          }),
        })
      )
    })
  })

  it('requires a valid latitude and longitude pair before saving', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({
          data: { success: true, cafe: { name: 'Coordinate Cafe', location: {} } },
        })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Settings />)

    await userEvent.click(await screen.findByRole('button', { name: /edit cafe details/i }))
    const latitude = screen.getByLabelText(/^Latitude$/i)
    const longitude = screen.getByLabelText(/^Longitude$/i)
    await userEvent.type(latitude, '-33.9249')
    await userEvent.click(screen.getByText('Save Cafe Details'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/latitude and longitude must both be provided/i)
    expect(mockPut).not.toHaveBeenCalled()

    await userEvent.type(longitude, '181')
    await userEvent.click(screen.getByText('Save Cafe Details'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/longitude must be a number between -180 and 180/i)
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('exposes all 9 ZA provinces in the dropdown', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({
          data: {
            success: true,
            cafe: { name: 'X', location: { address: '', city: 'Cape Town' } },
          },
        })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Settings />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /edit cafe details/i })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /edit cafe details/i }))

    const province = (await screen.findByLabelText(/^Province$/i)) as HTMLSelectElement
    const optionValues = Array.from(province.options).map((opt) => opt.value)
    for (const expected of [
      'Eastern Cape',
      'Free State',
      'Gauteng',
      'KwaZulu-Natal',
      'Limpopo',
      'Mpumalanga',
      'Northern Cape',
      'North West',
      'Western Cape',
    ]) {
      expect(optionValues).toContain(expected)
    }
  })

  it('cancels cafe details edits without saving', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({
          data: {
            success: true,
            cafe: { name: 'Original Cafe', location: { address: '1 Loop St', city: 'Cape Town' } },
          },
        })
      }
      if (url.includes('/events')) {
        return Promise.resolve({ data: { events: [] } })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Settings />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /edit cafe details/i })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /edit cafe details/i }))

    const nameInput = await screen.findByDisplayValue('Original Cafe')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Throwaway Name')

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

    await waitFor(() => {
      expect(screen.queryByDisplayValue('Throwaway Name')).not.toBeInTheDocument()
    })
    expect(mockPut).not.toHaveBeenCalled()
    expect(screen.getAllByText('Original Cafe').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /edit cafe details/i })).toBeInTheDocument()
  })

  it('points factor configuration to the planning workspace', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({
          data: { success: true, cafe: { name: 'Test Cafe', location: { address: '', city: 'Cape Town' } } },
        })
      }
      return Promise.resolve({ data: {} })
    })

    renderWithAuth(<Settings />)

    await userEvent.click(await screen.findByRole('button', { name: /prediction/i }))

    await waitFor(() => {
      expect(screen.getByText('Forecast Factors')).toBeInTheDocument()
    })

    expect(screen.getByText(/one dedicated workspace/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open forecast factors/i })).toHaveAttribute('href', '/planning/factors')
  })

  it('handles cafe name update', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.includes('/cafe/me')) {
        return Promise.resolve({
          data: { success: true, cafe: { name: 'Old Name', location: { address: '', city: 'Cape Town' } } },
        })
      }
      if (url.includes('/events')) {
        return Promise.resolve({ data: { events: [] } })
      }
      return Promise.resolve({ data: {} })
    })

    mockPut.mockResolvedValueOnce({ data: { success: true } })

    renderWithAuth(<Settings />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /edit cafe details/i })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /edit cafe details/i }))

    const nameInput = await screen.findByDisplayValue('Old Name')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'New Name')

    await userEvent.click(screen.getByText('Save Cafe Details'))

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/cafe/me', expect.objectContaining({
        name: 'New Name',
      }))
    })
  })

  describe('Trading Hours card', () => {
    const cafeWithHours = {
      name: 'Hours Cafe',
      location: { address: '', city: 'Cape Town' },
      tradingHours: [
        { dayOfWeek: 0, isOpen: false, openTime: '08:00', closeTime: '14:00' },
        { dayOfWeek: 1, isOpen: true, openTime: '07:00', closeTime: '17:00' },
        { dayOfWeek: 2, isOpen: true, openTime: '07:00', closeTime: '17:00' },
        { dayOfWeek: 3, isOpen: true, openTime: '07:00', closeTime: '17:00' },
        { dayOfWeek: 4, isOpen: true, openTime: '07:00', closeTime: '17:00' },
        { dayOfWeek: 5, isOpen: true, openTime: '07:00', closeTime: '17:00' },
        { dayOfWeek: 6, isOpen: true, openTime: '08:00', closeTime: '15:00' },
      ],
    }

    beforeEach(() => {
      mockGet.mockImplementation((url: string) => {
        if (url.includes('/cafe/me')) {
          return Promise.resolve({ data: { success: true, cafe: cafeWithHours } })
        }
        if (url.includes('/events')) {
          return Promise.resolve({ data: { events: [] } })
        }
        return Promise.resolve({ data: {} })
      })
    })

    const enterEditMode = async () => {
      const editButton = await screen.findByRole('button', { name: /edit trading hours/i })
      await userEvent.click(editButton)
    }

    it('defaults the trading hours card to view mode', async () => {
      renderWithAuth(<Settings />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /edit trading hours/i })).toBeInTheDocument()
      })

      expect(screen.queryByText('Save Trading Hours')).not.toBeInTheDocument()
      expect(screen.queryByRole('switch', { name: /Monday/i })).not.toBeInTheDocument()
      // Weekdays render 07:00 – 17:00 (5 days); Sunday renders "Closed".
      expect(screen.getAllByText(/07:00\s*–\s*17:00/).length).toBeGreaterThanOrEqual(5)
      expect(screen.getAllByText(/Closed/i).length).toBeGreaterThan(0)
    })

    it('renders a row for each day of the week in view mode', async () => {
      renderWithAuth(<Settings />)

      await waitFor(() => {
        expect(screen.getByText('Trading Hours')).toBeInTheDocument()
      })

      for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
        expect(screen.getByText(day)).toBeInTheDocument()
      }
    })

    it('toggles a day from open to closed after entering edit mode', async () => {
      renderWithAuth(<Settings />)
      await enterEditMode()

      const mondayToggle = await screen.findByRole('switch', { name: /^Monday open$/i })
      expect(mondayToggle).toHaveAttribute('aria-checked', 'true')
      await userEvent.click(mondayToggle)

      await waitFor(() => {
        expect(screen.getByRole('switch', { name: /^Monday closed$/i })).toHaveAttribute('aria-checked', 'false')
      })
    })

    it('submits the trading hours payload to PUT /cafe/me', async () => {
      mockPut.mockResolvedValueOnce({ data: { success: true } })

      renderWithAuth(<Settings />)
      await enterEditMode()

      await userEvent.click(await screen.findByText('Save Trading Hours'))

      await waitFor(() => {
        expect(mockPut).toHaveBeenCalledWith(
          '/cafe/me',
          expect.objectContaining({ tradingHours: expect.any(Array) })
        )
      })
      const call = mockPut.mock.calls.find((c) => c[0] === '/cafe/me' && c[1]?.tradingHours)
      expect(call?.[1].tradingHours).toHaveLength(7)
    })

    it('blocks save when an open day has closeTime <= openTime', async () => {
      renderWithAuth(<Settings />)
      await enterEditMode()

      const mondayClose = (await screen.findByLabelText(/Monday closing time/i)) as HTMLInputElement
      await userEvent.clear(mondayClose)
      await userEvent.type(mondayClose, '06:00')

      await userEvent.click(screen.getByText('Save Trading Hours'))

      await waitFor(() => {
        expect(screen.getByText(/closing time must be after opening time/i)).toBeInTheDocument()
      })
      expect(mockPut).not.toHaveBeenCalledWith('/cafe/me', expect.objectContaining({ tradingHours: expect.any(Array) }))
    })

    it('explains an invalid day at the field, before the user submits', async () => {
      renderWithAuth(<Settings />)
      await enterEditMode()

      const mondayClose = (await screen.findByLabelText(/Monday closing time/i)) as HTMLInputElement
      await userEvent.clear(mondayClose)
      await userEvent.type(mondayClose, '06:00')

      // No Save click: the row itself has to say what is wrong.
      await waitFor(() => {
        expect(mondayClose).toHaveAttribute('aria-invalid', 'true')
      })
      expect(screen.getByText(/overnight trading is not supported/i)).toBeInTheDocument()
      expect(mockPut).not.toHaveBeenCalled()
    })

    it('does not leave an empty bordered box when hours could not be loaded', async () => {
      mockGet.mockRejectedValue(new Error('network unavailable'))

      renderWithAuth(<Settings />)

      expect(await screen.findByText(/trading hours could not be loaded/i)).toBeInTheDocument()
    })

    it('warns before a reload discards unsaved trading hours', async () => {
      renderWithAuth(<Settings />)
      await enterEditMode()

      const mondayClose = (await screen.findByLabelText(/Monday closing time/i)) as HTMLInputElement
      await userEvent.clear(mondayClose)
      await userEvent.type(mondayClose, '18:00')

      // The cafe switcher in the sidebar calls window.location.reload(), so
      // beforeunload is the only thing standing between seven rows of
      // deliberate input and a single stray click.
      const event = new Event('beforeunload', { cancelable: true })
      await waitFor(() => {
        expect(window.dispatchEvent(event)).toBe(false)
      })
    })

    it('cancels trading hours edits without saving', async () => {
      renderWithAuth(<Settings />)
      await enterEditMode()

      const mondayToggle = await screen.findByRole('switch', { name: /^Monday open$/i })
      await userEvent.click(mondayToggle)
      expect(screen.getByRole('switch', { name: /^Monday closed$/i })).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /edit trading hours/i })).toBeInTheDocument()
      })
      expect(mockPut).not.toHaveBeenCalledWith('/cafe/me', expect.objectContaining({ tradingHours: expect.any(Array) }))
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })
  })

  describe('Cafe name validation', () => {
    beforeEach(() => {
      mockGet.mockImplementation((url: string) => {
        if (url.includes('/cafe/me')) {
          return Promise.resolve({
            data: { success: true, cafe: { name: 'Blouberg Coffee', location: { city: 'Cape Town' } } },
          })
        }
        return Promise.resolve({ data: {} })
      })
    })

    it('rejects a too-short cafe name in the browser rather than via Mongoose', async () => {
      renderWithAuth(<Settings />)
      await userEvent.click(await screen.findByRole('button', { name: /edit cafe details/i }))

      const nameInput = screen.getByLabelText(/cafe name/i)
      await userEvent.clear(nameInput)
      await userEvent.type(nameInput, 'B')
      await userEvent.click(screen.getByText('Save Cafe Details'))

      // The form is noValidate, so the `required` attribute is inert and an
      // empty name reached the API, coming back as raw Mongoose text.
      expect(await screen.findByText(/cafe name must be between 2 and 120 characters/i)).toBeInTheDocument()
      expect(nameInput).toHaveAttribute('aria-invalid', 'true')
      expect(mockPut).not.toHaveBeenCalled()
    })

    it('rejects an empty cafe name', async () => {
      renderWithAuth(<Settings />)
      await userEvent.click(await screen.findByRole('button', { name: /edit cafe details/i }))

      await userEvent.clear(screen.getByLabelText(/cafe name/i))
      await userEvent.click(screen.getByText('Save Cafe Details'))

      expect(await screen.findByText(/cafe name must be between 2 and 120 characters/i)).toBeInTheDocument()
      expect(mockPut).not.toHaveBeenCalled()
    })

    it('says plainly that weather needs coordinates rather than calling them optional', async () => {
      renderWithAuth(<Settings />)
      await userEvent.click(await screen.findByRole('button', { name: /edit cafe details/i }))

      // They are the on/off switch for the product's headline capability, not a
      // precision refinement: forecast.service gates the whole weather factor on
      // Number.isFinite(lat) && Number.isFinite(lng).
      expect(screen.getByText(/weather.*(off|unavailable|not).*until/i)).toBeInTheDocument()
    })
  })
  it('opens the cafe editor when sent here to set the location', async () => {
    // Today and Factors say "Set cafe location". Landing on the read-only
    // summary makes that a lie: latitude and longitude only exist once the
    // Edit button has been found and pressed.
    window.history.pushState({}, '', '/settings?section=general&edit=cafe')

    renderWithAuth(<Settings />)

    expect(await screen.findByLabelText(/latitude/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/longitude/i)).toBeInTheDocument()
    // The instruction is spent once carried out; a reload should not reopen it.
    await waitFor(() => expect(window.location.search).not.toMatch(/edit=cafe/))
  })

  it('does not open the editor when arriving at General normally', async () => {
    window.history.pushState({}, '', '/settings?section=general')

    renderWithAuth(<Settings />)

    expect(await screen.findByRole('button', { name: /edit cafe details/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/latitude/i)).not.toBeInTheDocument()
  })
  describe('trading hours vs the cafe’s own sales', () => {
    // Nothing checked these two against each other and they drift silently: a
    // weekday left marked closed forecasts zero however many months of sales
    // exist for it, and scores 0% every week without anyone being told why.
    const mockWithSundaySales = () => {
      mockGet.mockImplementation((url: string) => {
        if (url.includes('/analytics/heatmap')) {
          return Promise.resolve({
            data: {
              heatmap: [
                // `transactions` is the per-day average; `totalTransactions`
                // is the count. They differ here so reading the wrong one fails.
                { dayOfWeek: 0, hour: 9, revenue: 630, transactions: 15, totalRevenue: 5040, totalTransactions: 120, observedDays: 8 },
                { dayOfWeek: 0, hour: 10, revenue: 420, transactions: 10, totalRevenue: 3360, totalTransactions: 80, observedDays: 8 },
                { dayOfWeek: 2, hour: 9, revenue: 525, transactions: 12.5, totalRevenue: 4200, totalTransactions: 100, observedDays: 8 },
              ],
            },
          })
        }
        if (url.includes('/cafe/me')) {
          return Promise.resolve({
            data: {
              success: true,
              cafe: {
                name: 'Blouberg Coffee',
                location: { address: '123 Main St', city: 'Cape Town' },
                tradingHours: [
                  { dayOfWeek: 0, isOpen: false, openTime: '08:00', closeTime: '14:00' },
                  { dayOfWeek: 1, isOpen: true, openTime: '07:00', closeTime: '17:00' },
                  { dayOfWeek: 2, isOpen: true, openTime: '07:00', closeTime: '17:00' },
                  { dayOfWeek: 3, isOpen: true, openTime: '07:00', closeTime: '17:00' },
                  { dayOfWeek: 4, isOpen: true, openTime: '07:00', closeTime: '17:00' },
                  { dayOfWeek: 5, isOpen: true, openTime: '07:00', closeTime: '17:00' },
                  { dayOfWeek: 6, isOpen: true, openTime: '08:00', closeTime: '15:00' },
                ],
              },
            },
          })
        }
        if (url.includes('/events')) return Promise.resolve({ data: { events: [] } })
        return Promise.resolve({ data: {} })
      })
    }

    it('says a day with sales is treated as open while the hours are unsaved', async () => {
      mockWithSundaySales()
      const withSales = mockGet.getMockImplementation()!
      mockGet.mockImplementation((url: string) =>
        url.includes('/cafe/me')
          ? withSales(url).then((res: { data: { cafe: Record<string, unknown> } }) => ({
              data: { ...res.data, cafe: { ...res.data.cafe, tradingHoursSaved: false } },
            }))
          : withSales(url)
      )
      renderWithAuth(<Settings />)
      const hint = await screen.findByText(/200 sales/)
      expect(hint).toHaveTextContent(/not saved yet, so Planning treats this day as open/i)
      expect(hint).not.toHaveTextContent(/forecasts zero/i)
      expect(screen.getByText(/These are suggested hours, not saved yet/i)).toBeInTheDocument()
    })

    it('says so on the day, without changing anything', async () => {
      mockWithSundaySales()

      renderWithAuth(<Settings />)

      const hint = await screen.findByText(/200 sales/)
      expect(hint).toHaveTextContent(/your sales show trading on this day/i)
      // Stating a contradiction is not the same as resolving it: the owner may
      // have closed the day deliberately and the history may be stale.
      expect(mockPut).not.toHaveBeenCalled()
      expect(hint).toHaveTextContent(/this day forecasts zero/i)
    })

    it('carries the hint into the editor, where the switch is', async () => {
      mockWithSundaySales()

      renderWithAuth(<Settings />)

      fireEvent.click(await screen.findByRole('button', { name: /edit trading hours/i }))

      expect(await screen.findByText(/200 sales/)).toBeInTheDocument()
      expect(screen.getByRole('switch', { name: /sunday closed/i })).toBeInTheDocument()
    })

    it('says nothing about a day the sales agree is closed', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url.includes('/analytics/heatmap')) {
          return Promise.resolve({
            data: {
              heatmap: [
                { dayOfWeek: 2, hour: 9, revenue: 525, transactions: 12.5, totalRevenue: 4200, totalTransactions: 100, observedDays: 8 },
              ],
            },
          })
        }
        if (url.includes('/cafe/me')) {
          return Promise.resolve({
            data: {
              success: true,
              cafe: {
                name: 'Blouberg Coffee',
                tradingHours: [{ dayOfWeek: 0, isOpen: false, openTime: '08:00', closeTime: '14:00' }],
              },
            },
          })
        }
        if (url.includes('/events')) return Promise.resolve({ data: { events: [] } })
        return Promise.resolve({ data: {} })
      })

      renderWithAuth(<Settings />)

      expect(await screen.findByText('Trading Hours')).toBeInTheDocument()
      expect(screen.queryByText(/your sales show trading on this day/i)).toBeNull()
    })

    it('does not accuse a cafe that has no sales history yet', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url.includes('/analytics/heatmap')) return Promise.reject(new Error('no data'))
        if (url.includes('/cafe/me')) {
          return Promise.resolve({
            data: {
              success: true,
              cafe: {
                name: 'Brand New Cafe',
                tradingHours: [{ dayOfWeek: 0, isOpen: false, openTime: '08:00', closeTime: '14:00' }],
              },
            },
          })
        }
        if (url.includes('/events')) return Promise.resolve({ data: { events: [] } })
        return Promise.resolve({ data: {} })
      })

      renderWithAuth(<Settings />)

      expect(await screen.findByText('Trading Hours')).toBeInTheDocument()
      expect(screen.queryByText(/your sales show trading on this day/i)).toBeNull()
    })
  })
})
