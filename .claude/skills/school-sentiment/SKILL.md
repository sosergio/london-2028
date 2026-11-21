---
name: school-sentiment
description: Find out what parents say about a school on the London 2028 map - Ofsted Parent View figures, review sites (Snobe), Mumsnet and local forums - and save a short, sourced, neutral summary per school to data/school_views.csv, which the school popup shows. Use this whenever the user asks what parents think of a school, wants the "sentiment", "reputation", "reviews" or "what Mumsnet says" for one school, an area's schools or every school, or wants to refresh the Parent View numbers - even if they only say "what do people say about Bacon's?" or "check the schools in Leyton".
---

# School sentiment

For each school, the site shows two things in its popup:

1. **Ofsted Parent View figures**, filled for every school by a script.
2. **A researched summary**, written by hand from the web: a one-word verdict, one or two sentences, what review sites and forums say, and questions to ask at the open evening.

Both live in `data/school_views.csv`, one row per school, keyed by `urn` (the same URN as `data/schools.csv`). The popup code is `viewsHtml` in `js/format.js`. Paths are relative to the repo root.

## Step 1: Parent View numbers (script)

```
python3 .claude/skills/school-sentiment/scripts/parent_view.py 145313        # preview one school
python3 .claude/skills/school-sentiment/scripts/parent_view.py --write       # all schools, about 8 minutes
```

- It reads the public results page for each school. Ofsted publishes a year only once it has 10 answers, and parents answer mostly around an inspection, so the script steps back to the most recent year with results (as far as four years before the latest). `pv_year` and `pv_date` show how old the figures are. With no published year, the `pv_*` columns stay empty.
- A full run takes about 25 minutes the first time. Pages are cached in `--cache`, so a rerun is quick.
- It writes the `pv_*` columns and never touches the research columns.
- Run it for every school when refreshing, so all the figures come from the same date.
- Many schools have few answers. Read the n beside each figure. The bullying and SEND questions are answered only by parents whose child was bullied or has SEND, so their n is much smaller.

## Step 2: research one school

Work through these sources in this order, and note for each one **how many** reviews or posts there are, **their dates**, and whether they are **first-hand** (my child goes there) or **second-hand** (I've heard):

| Source | How | Notes |
|---|---|---|
| Ofsted Parent View | already in the row from step 1 | the most representative, but self-selected and mostly positive |
| Snobe | search `snobe <school name>` | star ratings and written reviews, often only a handful; give the average, n and date range |
| Mumsnet | search `site:mumsnet.com "<school name>"` | threads are often old and second-hand; give the years |
| Good Schools Guide | search `goodschoolsguide <school name>` | often paywalled; if you can't read it, say so |
| Other | `"<school name>" parents reviews`, `"<school name>" reddit`, local news on the school (exclusions, a new head, academy changes) | Facebook groups and Nextdoor can't be read; don't guess at them |
| Intake | GIAS or the DfE school census: pupils with English as an additional language | answers "are families from other countries normal there?" with a number, not an impression |

Also look for anything from international or expat families in particular, and say plainly if there is none.

Then pick the verdict:

- **positive**: Parent View recommend is 85% or more, and reviews and forums have no recurring complaint.
- **negative**: recommend is below 70%, or at least 5 reviews average under 2.5/5 and the forums agree.
- **mixed**: the sources disagree, or the same complaint keeps coming back (behaviour, bullying, communication, SEND) despite good headline figures.
- **thin**: fewer than 20 Parent View answers and almost nothing else. Say this rather than stretching a verdict out of three reviews.

## Step 3: write the row

Fill these columns in `data/school_views.csv` (add a row with the urn and name if the school has none):

| Column | What goes in it | Example (Bacon's College) |
|---|---|---|
| `sentiment` | positive / mixed / negative / thin | `mixed` |
| `summary` | one or two sentences: where the sources agree or split, and the recurring theme | Official survey mostly positive, review sites and forums mostly negative; both keep returning to behaviour and bullying. |
| `reviews` | site, average, n, date range, then the themes in a few words | Snobe 1.9/5 from 10 reviews (Dec 2024–May 2026): rude pupils, bullying, a "chaotic" atmosphere, inconsistent discipline; some praise for kind teachers and a helpful Head of Year |
| `forums` | site, number of threads, years, the gist, and first- or second-hand | Mumsnet, two short threads (2021, 2025): "never had a great reputation" but management seen as improving it; mostly second-hand |
| `ask` | two or three questions for the open evening, drawn from the weak spots | How bullying is reported and followed up; how SEND support works day to day; how consistently the behaviour policy is applied |
| `sources` | the URLs you actually read, separated by spaces | |
| `checked` | the date of the research, YYYY-MM-DD | |

Writing rules:

- **Neutral and attributed.** Write "reviewers describe…" or "parents on Mumsnet say…", never a claim in your own voice. Quote only a few words at a time.
- **No names of pupils or staff**, and no allegations about a named person. Job titles are fine ("a helpful Head of Year").
- **Don't overstate thin evidence.** Say how many reviews there were. End with what to ask, not a verdict.
- **Leave out a CSV column rather than guess.** If a source can't be read, put that in `forums` or `reviews` (for example "Good Schools Guide page not readable").

## Step 4: report back in chat

Use the same shape every time, so that schools can be compared:

> Parents are **split / mostly positive / mostly negative** on <school>. <one-sentence why>.
> • Ofsted Parent View (n answers, to date): X% would recommend, Y% say their child feels safe, Z% say pupils behave well. Bullying dealt with well: B% (n). SEND support: S% (n).
> • <Review site> (n reviews, date range): average R/5. Themes…
> • <Forum> (threads, years): gist, first- or second-hand.
> International families: <what was found, or "nothing in particular">; <EAL %> of pupils speak English as an additional language.
> Caveat: few, self-selected reviews; questions to take to the open evening: …

## Many schools

There are about 240 schools on the map, and each one needs real reading. Work **area by area** (`area_id` in `schools.csv`). Do the schools the user is most likely to consider first: Good or Outstanding, then the nearest to the area centre. Commit after each area ("Add parent views for Leyton schools"). Use parallel subagents only if the user asks for them.

## Rules that always apply

- **The repository is public.** Never write the family's details into any file. That means no names, address, employer, income or health, and **no child's condition or needs**. If the user mentions their own child's needs, ask generic questions ("how SEND support works") and keep anything more specific in the chat.
- Keep the CSV clean: UTF-8, a header row, quotes only where needed, and column order unchanged (`csv.DictWriter` handles this).
- The research columns are judgement: date them (`checked`) and refresh them when a school gets a new Ofsted inspection or a new head.
- After changing the popup, check one school locally (`python3 -m http.server`) and add a line to the notes in `index.html` if the meaning of a field changes.
