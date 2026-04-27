begin;

with missing as (
    select
        o.id as order_id,
        o.created_at,
        o.customer_email,
        o.payment_method,
        o.stripe_payment_id,
        case
            when o.payment_method is not null then 'admin'
            when o.stripe_payment_id is not null then 'checkout'
            else null
        end as inferred_actor_type,
        case
            when o.payment_method is not null then 'payment_method_present'
            when o.stripe_payment_id is not null then 'stripe_payment_id_present'
            else null
        end as inferred_from
    from orders o
    left join order_events oe
      on oe.order_id = o.id
     and oe.event_type = 'order_created'
    where oe.order_id is null
)
insert into order_events (
    id,
    order_id,
    event_type,
    from_status,
    to_status,
    actor_type,
    actor_id,
    request_id,
    payload_json,
    created_at
)
select
    gen_random_uuid(),
    m.order_id,
    'order_created',
    null,
    null,
    m.inferred_actor_type,
    null,
    'backfill_order_created_source_2026_04_27',
    jsonb_build_object(
        'backfilled', true,
        'source_only_backfill', true,
        'inferred_from', m.inferred_from,
        'customer_email', m.customer_email,
        'payment_method', m.payment_method,
        'stripe_payment_id_present', (m.stripe_payment_id is not null)
    ),
    m.created_at
from missing m
where m.inferred_actor_type is not null;

commit;
