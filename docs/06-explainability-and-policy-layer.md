# 6. Explainability and Policy Layer

## 6.1 Explainability Goals

- Convert technical outputs into simple and actionable language.
- Keep citizen messaging transparent and non-alarming unless emergency.
- Provide factor-based reasoning for trust.

## 6.2 Explainability Inputs

- current AQI and category
- primary pollutant
- pollutant contribution percentages
- short-term forecast trend
- weather and wind signals
- crisis state

## 6.3 Citizen Explanation Template

Template fields:
- status summary
- main cause
- expected next 1-3 hour trend
- simple precaution line

Example output:
"AQI is 182 (Poor) in your ward. PM2.5 is the main contributor, supported by low wind and traffic buildup. Levels are likely to rise in the next 2 hours."

## 6.4 Government Explanation Variant

Adds:
- quantified risk drivers
- confidence score
- affected population signal
- suggested intervention priority

## 6.5 Policy Recommendation Engine

Inputs:
- ward AQI and crisis level
- PMI and forecast trajectory
- vulnerability markers (schools, hospitals, population density)

Outputs:
- city-wide ward risk ranking
- intervention list

Intervention categories:
- traffic control
- industrial emission checks
- construction activity restrictions
- school activity advisory
- emergency response escalation

## 6.6 Recommendation Safeguards

- Every recommendation includes:
  - reason codes
  - confidence score
  - last-updated timestamp
- Human override:
  - authorized users can acknowledge, snooze, or override suggested actions.

