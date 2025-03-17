/*
  # Create Sensor Data Table

  1. New Tables
    - `sensor_data`
      - `id` (uuid, primary key)
      - `temperature` (float, not null)
      - `humidity` (float, not null)
      - `gas_level` (float, not null)
      - `created_at` (timestamp with time zone, default: now())

  2. Security
    - Enable RLS on `sensor_data` table
    - Add policy for authenticated users to read all sensor data
    - Add policy for authenticated users to insert sensor data
*/

CREATE TABLE IF NOT EXISTS sensor_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  temperature float NOT NULL,
  humidity float NOT NULL,
  gas_level float NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sensor_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read sensor data"
  ON sensor_data
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert sensor data"
  ON sensor_data
  FOR INSERT
  TO authenticated
  WITH CHECK (true);