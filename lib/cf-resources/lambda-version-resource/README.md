# Lambda Version Resource

This Lambda function improves upon the default `AWS::Lambda::Version` CloudFormation resource. The main advantage being that it automatically publishes a new version during update and create events and does nothing on delete event. This means it can be used as a means to ensure that there is always a version that is equivalent to $LATEST when `AWS::Lambda::Function` is deployed alongside this resource.

## Supported Properties

The supported properties match those of `AWS::Lambda::Version`.

Property | Type | Contents
---------|------|----------
`CodeSha256` | String | SHA256 hash of the code, used for validation
`Description` | String | A description of the version you are publishing
`FunctionName` | String | The Lambda function for which you want to publish a version. Both ARN as well as the name works.

## Example

An example use of this resource in a CloudFormation template is as follows, publishing a version on function named `foo-bar-baz`.

```json
"FooVersion": {
    "Type": "Custom::LambdaVersion",
    "Properties": {
        "ServiceToken": "ARN of this Lambda function",
        "FunctionName": "foo-bar-baz"
    }
}
```

## Deployment

Deployment of this Lambda function should go through the `lambda setup` script, which will take care of both creating the function as well as uploading the suitable code to it.
