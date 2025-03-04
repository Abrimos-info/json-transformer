# json-transformer

Transform JSON objects.

## Install

```
npm install
```

## Run

```
(stream of JSON lines) | node json-transformer/index.js -t TRANSFORM | (stream of JSON lines)
```

## Parameters

```
--transform     -t      Transformation to apply to each object.
```

## Data

Data should be streamed into script as JSON lines, one valid JSON object per line.
