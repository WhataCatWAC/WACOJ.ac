import type { JSONSchema7 } from 'json-schema';

const problemConfigSchema: JSONSchema7 = {
  type: 'object',
  definitions: {
    cases: { type: 'array', items: { $ref: '#/definitions/case' } },
    case: {
      type: 'object',
      properties: {
        input: { type: 'string' },
        output: { type: 'string' },
        time: { $ref: '#/definitions/time' },
        memory: { $ref: '#/definitions/memory' },
        score: { $ref: '#/definitions/score', description: 'score' },
      },
      required: ['input'],
      additionalProperties: false,
    },
    subtask: {
      description: 'Subtask Info',
      type: 'object',
      properties: {
        type: { enum: ['min', 'max', 'sum'] },
        time: { $ref: '#/definitions/time' },
        memory: { $ref: '#/definitions/memory' },
        score: { $ref: '#/definitions/score', description: 'score' },
        cases: { $ref: '#/definitions/cases' },
        if: { type: 'array', items: { type: 'integer' } },
        id: { type: 'integer' },
      },
      required: ['score'],
      additionalProperties: false,
    },
    time: { type: 'string', pattern: '^([0-9]+(?:\\.[0-9]*)?)([mu]?)s?$' },
    memory: { type: 'string', pattern: '^([0-9]+(?:\\.[0-9]*)?)([kKmMgG])[bB]?$' },
    score: { type: 'integer', maximum: 100, minimum: 1 },
  },
  properties: {
    redirect: { type: 'string', pattern: '[0-9a-zA-Z_-]+\\/[0-9]+' },
    key: { type: 'string', pattern: '[0-9a-f]{32}' },
    type: { enum: ['default', 'interactive', 'submit_answer', 'objective', 'remote_judge'] },
    subType: { type: 'string' },
    langs: { type: 'array', items: { type: 'string' } },
    target: { type: 'string' },
    checker_type: { enum: ['default', 'lemon', 'syzoj', 'hustoj', 'testlib', 'strict', 'qduoj'] },
    checker: { type: 'string', pattern: '\\.' },
    interactor: { type: 'string', pattern: '\\.' },
    validator: { type: 'string', pattern: '\\.' },
    user_extra_files: { type: 'array', items: { type: 'string' } },
    judge_extra_files: { type: 'array', items: { type: 'string' } },
    cases: { $ref: '#/definitions/cases' },
    subtasks: { type: 'array', items: { $ref: '#/definitions/subtask' } },
    filename: { type: 'string' },
    detail: { type: 'boolean' },
    time: { $ref: '#/definitions/time' },
    memory: { $ref: '#/definitions/memory' },
    score: { $ref: '#/definitions/score' },
    template: {
      type: 'object',
      patternProperties: {
        '^.*$': {
          type: 'array',
          minLength: 2,
          maxLength: 2,
          items: { type: 'string' },
        },
      },
      additionalProperties: false,
    },
    answers: {
      type: 'object',
      patternProperties: {
        '^\\d+(-\\d+)?$': {
          type: 'array',
          minLength: 2,
          maxLength: 2,
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export default problemConfigSchema;
