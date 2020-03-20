# ember-template-size

## usage

```sh
ember-template-size [options] <path>
```
### options
| name  | multiple | description   | default |
|-------- |---------------|---------|-|
| ouput | no | report json path |  template-size-report.json|
| glob  | yes | template glob(s) | **/*.hbs |
| ignore | yes | ignore glob(s) | **/node_modules .git tmp dist config build |
