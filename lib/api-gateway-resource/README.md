# API Gateway Resource

This Lambda function adds support for AWS API Gateway in CloudFormation stacks.

## Supported Properties

Properties that are supported as part of the `Properties` key in CloudFormation templates for this resource are:
`StageName`, `Definition`, `Variables`.

Property | Type  | Contents
-------- | ----- | --------
`StageName` | `String` | Used as the stage name to deploy, must be present
`Definition` | `Map/Hash/Object` | Information about the location of the API Swagger definition
-> `S3Bucket` | `String` | Bucket name where the API definition resides
-> `S3Key` | `String` | Key to the file of the API definition
-> `S3ObjectVersion` | `String` | OPTIONAL. Object version of the API definition, in case the S3 key is versioned
`Variables` | `Map/Hash/Object` | OPTIONAL. Variables to change in the API definition, keys of the object correspond to `$` variable names in the API definition, values to their replacements. `foo: bar` would result `$foo` being replaced with `bar` in the API definition.

## Example

An example use of this resource in a CloudFormation template is as follows, defining an API with stage `dev` and a definition that is in S3 `test-bucket/api.json`.

```json
"TestAPIGateway": {
    "Type": "Custom::APIGateway",
    "Properties": {
        "ServiceToken": "ARN of this Lambda function",
        "StageName": "dev",
        "Definition": {
            "S3Bucket": "test-bucket",
            "S3Key": "api.json"
        },
        "Variables": {
            "foo": "bar"
        }
    }
}
```

## Deployment

Deployment of this Lambda function should go through the `lambda setup` script, which will take care of both creating the function as well as uploading the suitable code to it.
