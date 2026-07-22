import { describe, expect, it } from 'vitest'
import { injectLifecycleBlock } from './generator'

describe('injectLifecycleBlock', () => {
  it('inserts a create_before_destroy lifecycle block before the resource block\'s closing brace', () => {
    const hcl = `resource "aws_instance" "res_ec2_prod_01" {
  instance_type = "m5.large"
  ami           = "ami-0c101f26f147fa7fd"
}`
    const result = injectLifecycleBlock(hcl)

    expect(result).toContain('lifecycle {')
    expect(result).toContain('create_before_destroy = true')
    // The lifecycle block must land inside the resource's braces, not appended after it.
    expect(result.trim().endsWith('}')).toBe(true)
    expect(result.indexOf('lifecycle')).toBeLessThan(result.lastIndexOf('}'))
  })

  it('preserves every attribute already in the resource block', () => {
    const hcl = `resource "aws_ecs_service" "res_ecs_prod_01" {
  desired_count = 2
  launch_type   = "FARGATE"
  tags = {
    "Name" = "res-ecs-prod-01"
  }
}`
    const result = injectLifecycleBlock(hcl)

    expect(result).toContain('desired_count = 2')
    expect(result).toContain('launch_type   = "FARGATE"')
    expect(result).toContain('"Name" = "res-ecs-prod-01"')
    expect(result).toContain('lifecycle {')
  })
})
