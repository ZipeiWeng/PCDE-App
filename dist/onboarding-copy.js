import { onboardingSteps } from './onboarding-flow.js';

// One short caption per scene; animations carry the action demonstration.
export function coachCopy(id, language = 'en') {
  return onboardingSteps(language).find(step => step.id === id)?.label || '';
}
