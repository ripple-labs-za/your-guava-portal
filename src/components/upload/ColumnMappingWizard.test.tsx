import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { ColumnMappingWizard } from './ColumnMappingWizard'
import type { ColumnMapping } from '@/types/upload'

const headers = ['Txn', 'When', 'Description', 'Amount']
const preview = [
  { Txn: 'A1', When: '2026-04-01 08:30', Description: '1 x Flat White', Amount: '32.00' },
]

const baseMapping: ColumnMapping = { date: 'When', items: 'Description', total: 'Amount' }

describe('ColumnMappingWizard', () => {
  it('disables confirm when required fields are unmapped', () => {
    const onConfirm = vi.fn()
    render(
      <ColumnMappingWizard
        open
        headers={headers}
        preview={preview}
        initialMapping={{ date: 'When' }}
        initialItemsMode="packed"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    )
    const confirm = screen.getByRole('button', { name: /confirm/i })
    expect(confirm).toBeDisabled()
  })

  it('calls onConfirm with mapping when all required fields set', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(
      <ColumnMappingWizard
        open
        headers={headers}
        preview={preview}
        initialMapping={baseMapping}
        initialItemsMode="packed"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    )
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ date: 'When', items: 'Description', total: 'Amount' }),
      'packed'
    )
  })

  it('rejects reusing one source column for multiple canonical fields', () => {
    render(
      <ColumnMappingWizard
        open
        headers={headers}
        preview={preview}
        initialMapping={{ date: 'When', items: 'When', total: 'Amount' }}
        initialItemsMode="packed"
        onConfirm={vi.fn()}
        onCancel={() => {}}
      />
    )

    expect(screen.getByText(/each field needs its own source column/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
  })

  it('requires receipt ID for line-per-row imports', () => {
    const onConfirm = vi.fn()
    render(
      <ColumnMappingWizard
        open
        headers={headers}
        preview={preview}
        initialMapping={baseMapping}
        initialItemsMode="line-per-row"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    )

    expect(screen.getByText(/receipt id is required/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
  })

  it('allows line-per-row imports after receipt ID is mapped', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(
      <ColumnMappingWizard
        open
        headers={headers}
        preview={preview}
        initialMapping={baseMapping}
        initialItemsMode="line-per-row"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    )

    const receiptSelect = screen.getAllByRole('combobox')[4]
    await user.selectOptions(receiptSelect, 'Txn')
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ date: 'When', items: 'Description', total: 'Amount', receiptId: 'Txn' }),
      'line-per-row'
    )
  })

  it('accepts one combined timestamp column for both Date and Time', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(
      <ColumnMappingWizard
        open
        headers={headers}
        preview={preview}
        initialMapping={{ date: 'When', time: 'When', items: 'Description', total: 'Amount' }}
        initialItemsMode="packed"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    )

    expect(screen.queryByText(/each field needs its own source column/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ date: 'When', time: 'When' }),
      'packed'
    )
  })

  it('does not treat a column from a different file as a completed mapping', () => {
    render(
      <ColumnMappingWizard
        open
        headers={['Trans. Date', 'Products', 'Gross']}
        preview={[]}
        // The names a previously staged file used. None of them exist here.
        initialMapping={{ date: 'When', items: 'Description', total: 'Amount' }}
        initialItemsMode="packed"
        onConfirm={vi.fn()}
        onCancel={() => {}}
      />
    )

    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
    expect(screen.getByLabelText(/^Date/)).toHaveValue('')
  })

  it('explains an unmappable file instead of offering an empty form', () => {
    render(
      <ColumnMappingWizard
        open
        headers={[]}
        preview={[]}
        initialMapping={{ date: 'Date', items: 'Items', total: 'Total' }}
        initialItemsMode="packed"
        onConfirm={vi.fn()}
        onCancel={() => {}}
      />
    )

    expect(screen.getByText(/no longer stored/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
  })

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup()
    render(
      <ColumnMappingWizard
        open
        headers={headers}
        preview={preview}
        initialMapping={baseMapping}
        initialItemsMode="packed"
        onConfirm={vi.fn()}
        onCancel={() => {}}
      />
    )

    const confirm = screen.getByRole('button', { name: /confirm/i })
    confirm.focus()
    await user.tab()

    expect(document.activeElement).toBe(screen.getByLabelText(/^Date/))
  })

  it('returns focus to whatever opened it', async () => {
    const user = userEvent.setup()
    const trigger = document.createElement('button')
    trigger.textContent = 'open'
    document.body.appendChild(trigger)
    trigger.focus()

    const { rerender } = render(
      <ColumnMappingWizard
        open
        headers={headers}
        preview={preview}
        initialMapping={baseMapping}
        initialItemsMode="packed"
        onConfirm={vi.fn()}
        onCancel={() => {}}
      />
    )

    // A parent re-render (new inline onCancel each time) must not re-capture
    // the dialog itself as the restore target.
    rerender(
      <ColumnMappingWizard
        open
        headers={headers}
        preview={preview}
        initialMapping={baseMapping}
        initialItemsMode="packed"
        onConfirm={vi.fn()}
        onCancel={() => {}}
      />
    )
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    rerender(
      <ColumnMappingWizard
        open={false}
        headers={headers}
        preview={preview}
        initialMapping={baseMapping}
        initialItemsMode="packed"
        onConfirm={vi.fn()}
        onCancel={() => {}}
      />
    )

    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('points a blocked required field at the message that explains it', () => {
    render(
      <ColumnMappingWizard
        open
        headers={headers}
        preview={preview}
        initialMapping={baseMapping}
        initialItemsMode="line-per-row"
        onConfirm={vi.fn()}
        onCancel={() => {}}
      />
    )

    const receipt = screen.getByLabelText(/^Receipt ID/)
    expect(receipt).toHaveAttribute('aria-required', 'true')
    expect(receipt).toHaveAttribute('aria-invalid', 'true')
    const describedBy = receipt.getAttribute('aria-describedby') || ''
    expect(document.getElementById(describedBy)).toHaveTextContent(/receipt id is required/i)
  })

  it('can be given copy for a re-mapping context', () => {
    render(
      <ColumnMappingWizard
        open
        headers={headers}
        preview={preview}
        initialMapping={baseMapping}
        initialItemsMode="packed"
        title="Change how this file is read"
        description="Re-importing replaces the 412 transactions currently linked to this upload."
        confirmLabel="Re-import with these columns"
        onConfirm={vi.fn()}
        onCancel={() => {}}
      />
    )

    expect(screen.getByRole('dialog', { name: /change how this file is read/i })).toBeInTheDocument()
    expect(screen.getByText(/replaces the 412 transactions/i)).toBeInTheDocument()
    expect(screen.queryByText(/couldn't auto-detect/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /re-import with these columns/i })).toBeInTheDocument()
  })

  it('shows the value each mapped column will import, telling two Total columns apart', async () => {
    const user = userEvent.setup()
    render(
      <ColumnMappingWizard
        open
        headers={['Date', 'Items', 'Total', 'Total (2)']}
        preview={[{ Date: '2026-09-14', Items: '1 x Latte', Total: '100.00', 'Total (2)': '86.96' }]}
        initialMapping={{ date: 'Date', items: 'Items', total: 'Total (2)' }}
        initialItemsMode="packed"
        onConfirm={vi.fn()}
        onCancel={() => {}}
      />
    )
    const total = screen.getByLabelText(/total amount/i)
    expect(within(total).getByRole('option', { name: 'Total (2)' })).toBeInTheDocument()
    expect(total).toHaveAccessibleDescription(/reads 86\.96/i)

    await user.selectOptions(total, 'Total')
    expect(total).toHaveAccessibleDescription(/reads 100\.00/i)
  })
})
