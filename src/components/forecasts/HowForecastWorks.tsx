import type { ReactNode } from 'react'

/**
 * "How this forecast works": the forecast in plain words, for paying customers. Every number here is the engine's
 * default (forecastFactors.service.js, forecast/history.js, forecast/calibration.js, weather.service.js on 3 Nov);
 * owners can change the factor percentages in Factors > Rules. It must never claim more than the code does.
 * A native <details> keeps it closed by default, keyboard-operable and announced as a disclosure.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold text-text">{title}</h3>
      <div className="space-y-1.5 text-xs leading-relaxed text-muted">{children}</div>
    </section>
  )
}

export function HowForecastWorks({ className = '' }: { className?: string }) {
  return (
    <details className={`group rounded-lg border border-border bg-[#111111] ${className}`}>
      <summary className="cursor-pointer select-none px-3 py-2.5 text-xs font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-guava-red">
        How this forecast works
      </summary>
      <div className="space-y-4 border-t border-border px-3 py-3">
        <Section title="1. The starting point: your own sales">
          <p>
            Each item starts from what it sold on the same weekday over the last 8 weeks. Recent weeks count most:
            the last three weeks carry 35%, 25% and 20% of the weight, and the five weeks before that share the
            remaining 20%. Weeks with no data are left out rather than counted as zero.
          </p>
          <p>
            Before averaging, each past day has its own factors taken out (a payday, a holiday, an event, the weather
            recorded for that day), so a busy payday last month does not inflate a normal day. Once there are at least
            four weeks of history, a single week more than 1.5 times the usual (median) level is held at 1.5 times;
            two high weeks in a row are treated as a real change.
          </p>
        </Section>

        <Section title="2. The factors for the day">
          <p>Each factor multiplies the starting point. These are the defaults; you can change them in Factors.</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>Hot day (daytime high above 27°C): cold drinks +30%, coffee -10%.</li>
            <li>Cold day (below 18°C): coffee +15%, cold drinks -20%.</li>
            <li>Rain (1 mm or more, or a 70% chance or higher): -10% on every item.</li>
            <li>Public holiday +15%, school holiday +8%, both on the same day +20%.</li>
            <li>
              Payday +20%: the 25th, the last business day of the month and the 1st, each moved to the business day
              before when it falls on a weekend or public holiday.
            </li>
            <li>Local events you add: low +10%, medium +20%, high +35%, or your own percentage. Only the strongest event of the day counts.</li>
            <li>Load shedding: stage 1-2 -8%, stage 3-4 -22%, stage 5 or higher -40%, using the highest stage between 06:00 and 20:00.</li>
            <li>
              Trading hours and closures: a closed day forecasts nothing. A partial closure removes the share of the
              day&apos;s sales that normally falls in those hours.
            </li>
          </ul>
          <p>Holidays, paydays and load shedding are South African and apply only to cafes in South Africa.</p>
        </Section>

        <Section title="3. The combined limit">
          <p>
            The weather, load-shedding, holiday, payday and event factors together are held between 0.5 and 1.6 times
            the starting point, so stacked factors cannot halve or more than add 60% to an item on their own. When the
            limit applies, the day&apos;s breakdown says so. Trading hours and learning sit outside the limit.
          </p>
        </Section>

        <Section title="4. Learning from your actual sales">
          <p>
            Every day, once its sales are in, the forecast is compared with what actually sold. After 10 matched days
            within the last 60, an overall correction moves future forecasts toward what really happened. It grows
            gradually with the number of days and never changes a forecast by more than 15% either way. This runs on
            every plan.
          </p>
          <p>
            On Pro, corrections for each factor (after 12 matched days) and each item (after 20) are added, each held
            within 20% either way. A factor percentage you set yourself is kept as you set it.
          </p>
        </Section>

        <Section title="5. Weather">
          <p>
            Weather is looked up by the cafe&apos;s coordinates, or by its city when no coordinates are set. The forecast
            for each day is kept, and once the day is over the weather that actually happened is stored and used when
            that day becomes part of the history.
          </p>
        </Section>

        <Section title="When a factor cannot be used">
          <ul className="list-disc space-y-1 pl-4">
            <li><span className="text-text">Not connected</span>: the service that supplies this factor is not set up or did not respond. The factor is left out of the forecast until it works again.</li>
            <li><span className="text-text">Location needed</span>: the cafe has neither coordinates nor a city, so weather cannot be looked up. Add the city in Settings.</li>
            <li><span className="text-text">Not available yet</span>: the provider has not published this day yet, for example weather beyond its forecast range.</li>
            <li><span className="text-text">Not available in your country</span>: a South African signal for a cafe elsewhere.</li>
          </ul>
        </Section>
      </div>
    </details>
  )
}
