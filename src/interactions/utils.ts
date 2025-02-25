const todayRange = {
  name: 'Today',
  value: 'today'
} as const;

const fourWeeksRange = {
  name: '4 weeks',
  value: '4-weeks'
} as const;

const sixMonthsRange = {
  name: '6 months',
  value: '6-months'
} as const;

const lifetimeRange = {
  name: 'Lifetime',
  value: 'lifetime'
} as const;

export const rangeChoices = <IncludeToday extends boolean = false>(
  includeToday: IncludeToday = false as IncludeToday
): IncludeToday extends true
  ? [typeof todayRange, typeof fourWeeksRange, typeof sixMonthsRange, typeof lifetimeRange]
  : [typeof fourWeeksRange, typeof sixMonthsRange, typeof lifetimeRange] => {
  return (
    includeToday
      ? [todayRange, fourWeeksRange, sixMonthsRange, lifetimeRange]
      : [fourWeeksRange, sixMonthsRange, lifetimeRange]
  ) as ReturnType<typeof rangeChoices<IncludeToday>>;
};

export type TimeRangeValue = '14' | '30' | '180' | '365' | 'all';

export interface TimeRangeChoice {
  name: '2 weeks' | '1 month' | '6 months' | '1 year' | 'lifetime';
  value: TimeRangeValue;
}

export const TIME_RANGES: readonly TimeRangeChoice[] = [
  {
    name: '2 weeks',
    value: '14'
  },
  {
    name: '1 month',
    value: '30'
  },
  {
    name: '6 months',
    value: '180'
  },
  {
    name: '1 year',
    value: '365'
  },
  {
    name: 'lifetime',
    value: 'all'
  }
] as const;
