# Historical European Football Player Dataset Generator

## 1. Project Overview

This project is to build a comprehensive, structured JSON dataset of European football players. The dataset covers the 2005/06 to 2025/26 seasons, focusing on the top two professional leagues in seven major European countries: England, Italy, Spain, Germany, France, the Netherlands, and Portugal.

The final output is a single JSON file designed for efficient querying, making it ideal for applications like the player connection game.

### Key Features:

- **Unique Player Identification:** Generates a unique `player_ID` for each player using the formula: `lastName_dateOfBirth_countryCode`.
- **Complex Career Tracking:** Accurately models player careers, including mid-season transfers and loan spells, by listing a player under all affiliated clubs for a given season.
- **Structured JSON Output:** The data is organized into a clear, query-friendly JSON schema.

-----

